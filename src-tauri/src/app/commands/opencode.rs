// ============================================
// OpenCode Service Management (desktop only)
// Android 不支持子进程管理和 window.destroy()
// ============================================

use crate::app::service::ServiceState;
use serde::Serialize;
use std::{
    collections::VecDeque,
    env,
    ffi::OsString,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{atomic::Ordering, mpsc},
    thread,
    time::Duration,
};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartOpencodeServiceResult {
    started: bool,
    started_by_us: bool,
    url: Option<String>,
    /// 连接用的服务密码。两个来源：
    /// 1. v2 服务端生成的随机密码（无显式密码时 serve 自动生成并打印
    ///    `server password <pwd>` 到 stdout——官方 cli/server-process.ts 契约）；
    /// 2. 用户显式配置的 env 密码（OPENCODE_PASSWORD / OPENCODE_SERVER_PASSWORD，
    ///    此时服务端不打印随机密码，由我们把 env 值回传）。
    /// 前端必须把它写回本机条目 auth，否则后续所有 API/SSE 请求 401。
    /// 仅当密码来自「探测实际命中/服务端实际使用」的来源时才返回，
    /// 不会用存疑的 env 值覆盖条目上已可用的凭据。
    server_password: Option<String>,
}

struct SpawnedOpencodeServe {
    child: Child,
    output: mpsc::Receiver<String>,
}

/// 带可选 Basic 鉴权的健康检查，对齐官方实现：
/// v2 客户端用 server.info()（GET /api/info）探测；/global/health 是 v1 端点，
/// 保留为旧版后端的回退。WSL 侧 serve 启用了密码保护，
/// 不带凭据会收到 401 而误判为未就绪。
pub async fn is_service_running_with_auth(url: &str, auth: Option<(&str, &str)>) -> bool {
    let base = url.trim_end_matches('/');
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(c) => c,
        Err(_) => return false,
    };

    for path in ["/api/info", "/global/health"] {
        let mut request = client.get(format!("{}{}", base, path));
        if let Some((username, password)) = auth {
            request = request.basic_auth(username, Some(password));
        }
        // v2 服务器对未知路径会回退到 SPA 的 HTML（也是 200），
        // 因此必须确认返回的是 JSON
        let is_json_ok = request
            .timeout(Duration::from_secs(5))
            .send()
            .await
            .map(|r| {
                r.status().is_success()
                    && r.headers()
                        .get(reqwest::header::CONTENT_TYPE)
                        .and_then(|v| v.to_str().ok())
                        .map(|ct| ct.to_ascii_lowercase().contains("application/json"))
                        .unwrap_or(false)
            })
            .unwrap_or(false);
        if is_json_ok {
            return true;
        }
    }
    false
}

/// 启动 opencode serve 进程
fn spawn_opencode_serve(
    binary_path: &str,
    env_vars: &std::collections::HashMap<String, String>,
    serve_args: &[String],
) -> Result<SpawnedOpencodeServe, String> {
    log::info!(
        "Starting opencode serve with binary: {} (args: {})",
        binary_path,
        serve_args.join(" ")
    );
    if !env_vars.is_empty() {
        log::info!("Injecting {} environment variable(s)", env_vars.len());
    }

    let mut cmd = build_opencode_command(binary_path, serve_args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    // 注入用户配置的环境变量
    for (key, value) in env_vars {
        cmd.env(key, value);
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = cmd.spawn().map_err(|e| {
        format!(
            "Failed to start '{}': {}. Check that the path is correct.",
            binary_path, e
        )
    })?;

    let (tx, output) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        spawn_output_reader(stdout, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_output_reader(stderr, tx);
    }

    Ok(SpawnedOpencodeServe { child, output })
}

fn spawn_output_reader<R>(reader: R, tx: mpsc::Sender<String>)
where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut tx = Some(tx);
        for line in BufReader::new(reader).lines().map_while(Result::ok) {
            if let Some(sender) = tx.as_ref() {
                if sender.send(line).is_err() {
                    tx = None;
                }
            }
        }
    });
}

fn parse_listening_url(line: &str) -> Option<String> {
    let start = line.find("http://").or_else(|| line.find("https://"))?;
    let raw_url = line[start..]
        .split_whitespace()
        .next()?
        .trim_end_matches(|c| matches!(c, ',' | ';' | ')'));
    let normalized = raw_url
        .replace("http://0.0.0.0:", "http://127.0.0.1:")
        .replace("https://0.0.0.0:", "https://127.0.0.1:");
    let parsed = reqwest::Url::parse(&normalized).ok()?;

    Some(parsed.to_string().trim_end_matches('/').to_string())
}

/// 提取 v2 服务端自动生成的随机密码（官方 cli/server-process.ts:160：
/// `server password <pwd>` 打到 stdout）
fn parse_server_password(line: &str) -> Option<String> {
    let password = line.trim().strip_prefix("server password ")?.trim();
    if password.is_empty() {
        return None;
    }
    Some(password.to_string())
}

/// 官方约定的服务密码环境变量（新名优先、旧名兜底，
/// 对齐官方 cli/src/env.ts 的 `OPENCODE_PASSWORD orElse OPENCODE_SERVER_PASSWORD`）。
const SERVER_PASSWORD_ENV_KEYS: [&str; 2] = ["OPENCODE_PASSWORD", "OPENCODE_SERVER_PASSWORD"];

/// 在给定的 env 集合里按官方优先级找显式配置的密码。
fn password_from_env_vars(env_vars: &std::collections::HashMap<String, String>) -> Option<String> {
    for key in SERVER_PASSWORD_ENV_KEYS {
        for (env_key, value) in env_vars {
            if env_key.eq_ignore_ascii_case(key) && !value.is_empty() {
                return Some(value.clone());
            }
        }
    }
    None
}

/// 解析「用户显式配置」的服务密码：先条目注入的 env_vars，再进程环境。
///
/// 为什么必须读进程环境：GUI 应用继承系统/用户环境变量，spawn 的子进程
/// 默认也继承——用户在系统里设了 OPENCODE_SERVER_PASSWORD 时，serve 会用它
/// 且**不再打印随机密码**；ocui 若不识别，就绪探测与后续所有 API/SSE 请求
/// 全部 401，表现为「永远连不上、反复重启」。
fn configured_server_password(env_vars: &std::collections::HashMap<String, String>) -> Option<String> {
    if let Some(password) = password_from_env_vars(env_vars) {
        return Some(password);
    }
    for key in SERVER_PASSWORD_ENV_KEYS {
        if let Ok(value) = env::var(key) {
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

/// extra_args 里是否显式给了某个 flag（`--flag value` 或 `--flag=value` 两种写法都认）
fn extra_args_have_flag(extra_args: &[String], flag: &str) -> bool {
    let eq_prefix = format!("{flag}=");
    extra_args
        .iter()
        .any(|arg| arg == flag || arg.starts_with(&eq_prefix))
}

/// 从条目 URL 派生 serve 绑定参数。
///
/// 原则：默认场景裸 `opencode serve`，一个参数都不加——opencode 自己的
/// 默认值就是 127.0.0.1:4096，且端口被占时会自动换端口；实际绑定地址
/// 以 serve stdout 的 listening URL 为准（parse_listening_url）。
/// 只有两种情况才传参：
/// 1. 条目 URL 配置了非默认主机/端口（用户自己的配置，serve 要绑到那里）；
/// 2. 设置页「启动参数」（extra_args）原样追加。
/// extra_args 显式给了 --hostname/--port 时，对应派生值省略，
/// 不依赖 CLI 解析器「重复 flag 后到生效」的行为。
fn serve_args_from_url(url: &str, extra_args: &[String]) -> Vec<String> {
    const DEFAULT_PORT: u16 = 4096;

    let mut args = vec!["serve".to_string()];
    let user_hostname = extra_args_have_flag(extra_args, "--hostname");
    let user_port = extra_args_have_flag(extra_args, "--port");
    if let Ok(parsed) = reqwest::Url::parse(url) {
        let host = parsed.host_str().unwrap_or("");
        // 127.0.0.1 / localhost 与 opencode 默认绑定一致，无需显式传
        let is_default_host = host.is_empty() || host == "127.0.0.1" || host == "localhost";
        let port = parsed.port();
        let is_default_port = port.is_none() || port == Some(DEFAULT_PORT);

        if !user_hostname && !is_default_host {
            args.push("--hostname".to_string());
            args.push(host.to_string());
        }
        if !user_port && !is_default_port {
            args.push("--port".to_string());
            args.push(port.expect("non-default port is Some").to_string());
        }
    }
    args.extend(extra_args.iter().cloned());
    args
}

/// 按优先级依次尝试多套凭据探测服务，返回命中的候选下标。
async fn probe_service_with_auths(url: &str, auths: &[Option<(&str, &str)>]) -> Option<usize> {
    for (index, auth) in auths.iter().enumerate() {
        if is_service_running_with_auth(url, *auth).await {
            return Some(index);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{parse_listening_url, parse_server_password};

    #[test]
    fn parses_generated_password_line() {
        assert_eq!(
            parse_server_password("server password 10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8"),
            Some("10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8".to_string())
        );
        // 带尾随空白/多余空行也要命中
        assert_eq!(
            parse_server_password("  server password abc123  "),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn ignores_non_password_lines() {
        assert_eq!(parse_server_password("server listening on http://127.0.0.1:4097"), None);
        assert_eq!(parse_server_password("server password "), None);
        assert_eq!(parse_server_password(""), None);
    }

    #[test]
    fn listening_url_and_password_coexist() {
        // v2.0.14 实机启动输出的两行：URL 与随机密码各自被对应解析器命中
        let url_line = "server listening on http://127.0.0.1:4097";
        let password_line = "server password 10oCmAyibNWQdMSa-NBRdSsDA5fcedgh__w2RkRA7s8";
        assert_eq!(parse_listening_url(url_line).as_deref(), Some("http://127.0.0.1:4097"));
        assert_eq!(parse_server_password(url_line), None);
        assert!(parse_server_password(password_line).is_some());
        assert_eq!(parse_listening_url(password_line), None);
    }

    #[test]
    fn configured_password_prefers_new_env_name() {
        let mut env_vars = std::collections::HashMap::new();
        env_vars.insert("OPENCODE_SERVER_PASSWORD".to_string(), "legacy".to_string());
        env_vars.insert("OPENCODE_PASSWORD".to_string(), "new".to_string());
        assert_eq!(
            super::password_from_env_vars(&env_vars),
            Some("new".to_string())
        );
    }

    #[test]
    fn configured_password_falls_back_to_legacy_and_ignores_empty() {
        let mut env_vars = std::collections::HashMap::new();
        env_vars.insert("OPENCODE_SERVER_PASSWORD".to_string(), "legacy".to_string());
        assert_eq!(
            super::password_from_env_vars(&env_vars),
            Some("legacy".to_string())
        );
        // 大小写不敏感（Windows 环境变量）
        let mut env_vars = std::collections::HashMap::new();
        env_vars.insert("opencode_server_password".to_string(), "lower".to_string());
        assert_eq!(
            super::password_from_env_vars(&env_vars),
            Some("lower".to_string())
        );
        // 空值视为未配置
        let mut env_vars = std::collections::HashMap::new();
        env_vars.insert("OPENCODE_SERVER_PASSWORD".to_string(), "".to_string());
        assert_eq!(super::password_from_env_vars(&env_vars), None);
    }

    #[test]
    fn serve_args_bare_serve_for_default_url() {
        // 默认条目（opencode 自身的默认绑定）：一个参数都不加，
        // 实际地址以 stdout 的 listening URL 为准（端口占用时 serve 会自己换端口）
        assert_eq!(super::serve_args_from_url("http://127.0.0.1:4096", &[]), vec!["serve"]);
        assert_eq!(super::serve_args_from_url("http://localhost:4096", &[]), vec!["serve"]);
        assert_eq!(super::serve_args_from_url("http://localhost", &[]), vec!["serve"]);
        assert_eq!(super::serve_args_from_url("not a url", &[]), vec!["serve"]);
    }

    #[test]
    fn serve_args_derive_only_custom_host_or_port() {
        // 条目 URL 配了非默认主机/端口才派生（用户自己的配置，serve 要绑到那里）
        assert_eq!(
            super::serve_args_from_url("http://0.0.0.0:5050/", &[]),
            vec!["serve", "--hostname", "0.0.0.0", "--port", "5050"]
        );
        assert_eq!(
            super::serve_args_from_url("http://127.0.0.1:5050", &[]),
            vec!["serve", "--port", "5050"]
        );
        assert_eq!(
            super::serve_args_from_url("http://0.0.0.0:4096", &[]),
            vec!["serve", "--hostname", "0.0.0.0"]
        );
    }

    #[test]
    fn serve_args_append_extra_args_last() {
        // 默认条目 + 额外参数：不注入派生值，原样追加
        let extra = vec!["--cors".to_string(), "https://example.com".to_string()];
        assert_eq!(
            super::serve_args_from_url("http://127.0.0.1:4096", &extra),
            vec!["serve", "--cors", "https://example.com"]
        );
    }

    #[test]
    fn serve_args_user_hostname_port_suppress_derived() {
        // 用户显式给 --hostname/--port 时以用户值为准，对应派生值省略
        let extra = vec!["--hostname".to_string(), "0.0.0.0".to_string()];
        assert_eq!(
            super::serve_args_from_url("http://192.168.1.2:5050", &extra),
            vec!["serve", "--port", "5050", "--hostname", "0.0.0.0"]
        );
        // --flag=value 写法同样生效
        let extra_eq = vec!["--port=5000".to_string()];
        assert_eq!(
            super::serve_args_from_url("http://192.168.1.2:5050", &extra_eq),
            vec!["serve", "--hostname", "192.168.1.2", "--port=5000"]
        );
        // 两者都给了就完全用用户的
        let both = vec!["--hostname".to_string(), "0.0.0.0".to_string(), "--port".to_string(), "5000".to_string()];
        assert_eq!(
            super::serve_args_from_url("http://192.168.1.2:5050", &both),
            vec!["serve", "--hostname", "0.0.0.0", "--port", "5000"]
        );
    }
}

fn remember_recent_output(recent_output: &mut VecDeque<String>, line: String) {
    if recent_output.len() >= 8 {
        recent_output.pop_front();
    }
    recent_output.push_back(line);
}

fn format_recent_output(recent_output: &VecDeque<String>) -> String {
    if recent_output.is_empty() {
        return String::new();
    }

    format!(
        " Recent output: {}",
        recent_output
            .iter()
            .cloned()
            .collect::<Vec<_>>()
            .join(" | ")
    )
}

fn build_opencode_command(binary_path: &str, args: &[String]) -> Command {
    #[cfg(target_os = "windows")]
    {
        let path = Path::new(binary_path);
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("");
        let requires_shell = ext.eq_ignore_ascii_case("cmd")
            || ext.eq_ignore_ascii_case("bat")
            || path.extension().is_none();

        if requires_shell {
            let mut cmd = Command::new("cmd.exe");
            cmd.arg("/C").arg(binary_path).args(args);
            return cmd;
        }
    }

    let mut cmd = Command::new(binary_path);
    cmd.args(args);
    cmd
}

fn patched_env_var(
    env_vars: &std::collections::HashMap<String, String>,
    key: &str,
) -> Option<OsString> {
    for (env_key, value) in env_vars {
        if env_key.eq_ignore_ascii_case(key) {
            return Some(OsString::from(value));
        }
    }
    env::var_os(key)
}

fn path_candidates(env_vars: &std::collections::HashMap<String, String>) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(bin) = patched_env_var(env_vars, "OPENCODE_BIN") {
        if !bin.is_empty() {
            candidates.push(PathBuf::from(bin));
        }
    }

    let Some(path) = patched_env_var(env_vars, "PATH") else {
        return candidates;
    };

    let names: Vec<&str> = if cfg!(windows) {
        vec!["opencode.exe", "opencode.cmd", "opencode.bat", "opencode"]
    } else {
        vec!["opencode"]
    };

    for dir in env::split_paths(&path) {
        for name in &names {
            candidates.push(dir.join(name));
        }
    }

    candidates
}

fn is_runnable_file(path: &Path) -> bool {
    path.is_file()
}

/// 自动检测 opencode 可执行文件，行为接近直接在终端输入 `opencode`。
#[tauri::command]
pub async fn detect_opencode_binary(
    env_vars: std::collections::HashMap<String, String>,
) -> Result<Option<String>, String> {
    for candidate in path_candidates(&env_vars) {
        if is_runnable_file(&candidate) {
            return Ok(Some(candidate.to_string_lossy().to_string()));
        }
    }

    Ok(None)
}

/// 跨平台杀进程
pub fn kill_process_by_pid(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg(pid.to_string())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}

/// 检查 opencode 服务是否在运行（带可选 Basic 凭据——v2 强制密码，
/// 无凭据的健康检查会 401 误判成未运行）
#[tauri::command]
pub async fn check_opencode_service(url: String, auth: Option<(String, String)>) -> Result<bool, String> {
    let health_auth = auth
        .as_ref()
        .map(|(username, password)| (username.as_str(), password.as_str()));
    Ok(is_service_running_with_auth(&url, health_auth).await)
}

/// 启动 opencode serve
#[tauri::command]
pub async fn start_opencode_service(
    state: State<'_, ServiceState>,
    url: String,
    binary_path: String,
    env_vars: std::collections::HashMap<String, String>,
    auth: Option<(String, String)>,
    extra_args: Option<Vec<String>>,
) -> Result<StartOpencodeServiceResult, String> {
    // 显式配置的密码（条目 env_vars → 进程环境，官方优先级）。
    // 子进程默认继承进程环境，因此 serve 一定会用它——探测与回传都必须认它。
    let configured_password = configured_server_password(&env_vars);
    if configured_password.is_some() {
        log::info!("Using explicitly configured server password (env)");
    }

    // 「已经在跑」的探测要按优先级尝试多套凭据——v2 服务端强制密码，
    // 拿错凭据探测会 401 误判成没在跑，进而重复 spawn 撞端口、反复重启。
    // 优先级：显式 env 密码 > 条目已存凭据 > 无凭据（v1/异常环境兜底）。
    // probe_report 记录命中后需要回传前端写回条目的密码（条目已有凭据不回传，
    // 避免用过期的 env 密码覆盖条目上实际可用的凭据）。
    let entry_auth = auth
        .as_ref()
        .map(|(username, password)| (username.as_str(), password.as_str()));
    let mut probe_auths: Vec<Option<(&str, &str)>> = Vec::new();
    let mut probe_report: Vec<Option<String>> = Vec::new();
    if let Some(password) = configured_password.as_deref() {
        probe_auths.push(Some(("opencode", password)));
        probe_report.push(Some(password.to_string()));
    }
    if entry_auth.is_some() {
        probe_auths.push(entry_auth);
        probe_report.push(None);
    }
    probe_auths.push(None);
    probe_report.push(None);

    if state.we_started.load(Ordering::SeqCst) {
        let current_url = state.service_url.lock().map_err(|e| e.to_string())?.clone();
        if let Some(current_url) = current_url {
            if let Some(winner) = probe_service_with_auths(&current_url, &probe_auths).await {
                log::info!("opencode service already running at {}", current_url);
                return Ok(StartOpencodeServiceResult {
                    started: false,
                    started_by_us: true,
                    url: Some(current_url),
                    server_password: probe_report[winner].clone(),
                });
            }
        }
    }

    if let Some(winner) = probe_service_with_auths(&url, &probe_auths).await {
        log::info!("opencode service already running at {}", url);
        return Ok(StartOpencodeServiceResult {
            started: false,
            started_by_us: false,
            url: Some(url),
            server_password: probe_report[winner].clone(),
        });
    }

    let serve_args = serve_args_from_url(&url, extra_args.as_deref().unwrap_or(&[]));
    let mut spawned = spawn_opencode_serve(&binary_path, &env_vars, &serve_args)?;
    let pid = spawned.child.id();
    log::info!("Started opencode serve, PID: {}", pid);

    state.child_pid.store(pid, Ordering::SeqCst);
    state.we_started.store(true, Ordering::SeqCst);
    *state.service_url.lock().map_err(|e| e.to_string())? = None;

    let mut detected_url: Option<String> = None;
    let mut detected_password: Option<String> = None;
    let mut recent_output = VecDeque::new();

    for _ in 0..30 {
        while let Ok(line) = spawned.output.try_recv() {
            if let Some(parsed_url) = parse_listening_url(&line) {
                log::info!("Detected opencode serve URL: {}", parsed_url);
                *state.service_url.lock().map_err(|e| e.to_string())? = Some(parsed_url.clone());
                detected_url = Some(parsed_url);
            }
            if detected_password.is_none() {
                if let Some(password) = parse_server_password(&line) {
                    log::info!("Detected opencode serve generated password");
                    detected_password = Some(password);
                }
            }
            remember_recent_output(&mut recent_output, line);
        }

        if let Some(status) = spawned.child.try_wait().map_err(|e| e.to_string())? {
            state.child_pid.store(0, Ordering::SeqCst);
            state.we_started.store(false, Ordering::SeqCst);
            *state.service_url.lock().map_err(|e| e.to_string())? = None;
            return Err(format!(
                "opencode serve exited during startup with status {}.{}",
                status,
                format_recent_output(&recent_output)
            ));
        }

        let health_url = detected_url.as_deref().unwrap_or(&url);
        // 就绪检查的凭据来源（按优先级）：
        // 1. 服务端刚打印的随机密码（未显式配置时强制生成）
        // 2. 显式配置的 env 密码（OPENCODE_PASSWORD / OPENCODE_SERVER_PASSWORD，
        //    来自条目 env_vars 或进程环境；此时服务端不打印随机密码）
        // 3. 条目上已有的凭据（碰巧与实际密码一致时也能秒级就绪）
        let ready_auth = detected_password
            .as_deref()
            .map(|password| ("opencode", password))
            .or(configured_password.as_deref().map(|password| ("opencode", password)))
            .or(entry_auth);
        if is_service_running_with_auth(health_url, ready_auth).await {
            log::info!("opencode service is ready at {}", health_url);
            *state.service_url.lock().map_err(|e| e.to_string())? = Some(health_url.to_string());
            return Ok(StartOpencodeServiceResult {
                started: true,
                started_by_us: true,
                url: Some(health_url.to_string()),
                server_password: detected_password.or_else(|| configured_password.clone()),
            });
        }

        tokio::time::sleep(Duration::from_millis(500)).await;
    }

    log::warn!("opencode service started but health check not passing yet");
    Ok(StartOpencodeServiceResult {
        started: true,
        started_by_us: true,
        url: detected_url,
        server_password: detected_password.or(configured_password),
    })
}

/// 停止 opencode serve
#[tauri::command]
pub async fn stop_opencode_service(state: State<'_, ServiceState>) -> Result<(), String> {
    let pid = state.child_pid.swap(0, Ordering::SeqCst);
    state.we_started.store(false, Ordering::SeqCst);
    *state.service_url.lock().map_err(|e| e.to_string())? = None;

    if pid > 0 {
        log::info!("Stopping opencode serve, PID: {}", pid);
        kill_process_by_pid(pid);
    }

    Ok(())
}

/// 查询是否由我们启动了 opencode 服务
#[tauri::command]
pub async fn get_service_started_by_us(state: State<'_, ServiceState>) -> Result<bool, String> {
    Ok(state.we_started.load(Ordering::SeqCst))
}

/// 确认关闭应用（前端调用，可选择是否同时停止服务）
#[tauri::command]
pub async fn confirm_close_app(
    window: tauri::Window,
    state: State<'_, ServiceState>,
    stop_service: bool,
) -> Result<(), String> {
    // 我们启动的 WSL 内 opencode 进程随应用退出统一清理，避免后台残留
    #[cfg(target_os = "windows")]
    {
        use tauri::Manager;
        let wsl_state = window.app_handle().state::<super::wsl_commands::WslState>();
        super::wsl_commands::stop_all_wsl_servers(&wsl_state).await;
    }

    if stop_service {
        let pid = state.child_pid.swap(0, Ordering::SeqCst);
        if pid > 0 {
            log::info!("Closing app and stopping opencode serve, PID: {}", pid);
            kill_process_by_pid(pid);
        }
        state.we_started.store(false, Ordering::SeqCst);
        *state.service_url.lock().map_err(|e| e.to_string())? = None;
    } else {
        log::info!("Closing app, keeping opencode serve running");
    }

    window.destroy().map_err(|e| e.to_string())
}
