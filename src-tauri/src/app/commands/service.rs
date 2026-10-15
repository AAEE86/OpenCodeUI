// ============================================
// OpenCode 后台服务注册表与服务配置（desktop only）
//
// 官方 v2 的共享后台服务模型（opencode serve --service）：
//   - 注册表：~/.local/state/opencode/service.json（XDG_STATE_HOME 优先），
//     运行中的服务进程自己写入 { id, version, pid, url, password }，
//     所有客户端（CLI/TUI/桌面端/ocui）靠它发现并认领同一个服务；
//   - 配置：~/.config/opencode/service.json（XDG_CONFIG_HOME 优先），
//     由 `opencode service set/unset` 写入（disabled/remote/hostname/port/
//     password/cors/env），改动在服务下次启动时生效。
// 两个文件同名不同目录，路径逻辑对齐官方 @opencode/util/global-roots.ts。
// ============================================

use serde::{Deserialize, Serialize};
use std::{collections::HashMap, env, path::PathBuf, process::Stdio, time::Duration};

/// 服务进程写入的注册表（官方 Service.Info 的 lenient 版本：字段缺失不致命）
#[derive(Deserialize, Debug, Clone)]
pub struct ServiceRegistration {
    // id/version 现在不参与判定，但保留解析以对齐官方 schema、便于日志排查
    #[allow(dead_code)]
    pub id: Option<String>,
    #[allow(dead_code)]
    pub version: Option<String>,
    pub pid: Option<u32>,
    pub url: String,
    pub password: Option<String>,
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

/// 纯函数版目录解析，便于单测（env 读取在调用处做一次）
fn state_dir_from(xdg_state_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(xdg) = xdg_state_home {
        return Some(xdg);
    }
    home.map(|home| home.join(".local").join("state"))
}

fn config_dir_from(xdg_config_home: Option<PathBuf>, home: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(xdg) = xdg_config_home {
        return Some(xdg);
    }
    home.map(|home| home.join(".config"))
}

fn state_dir() -> Option<PathBuf> {
    state_dir_from(
        env::var_os("XDG_STATE_HOME").filter(|v| !v.is_empty()).map(PathBuf::from),
        home_dir(),
    )
}

fn config_dir() -> Option<PathBuf> {
    config_dir_from(
        env::var_os("XDG_CONFIG_HOME").filter(|v| !v.is_empty()).map(PathBuf::from),
        home_dir(),
    )
}

pub fn registration_path() -> Option<PathBuf> {
    Some(state_dir()?.join("opencode").join("service.json"))
}

fn config_path() -> Option<PathBuf> {
    Some(config_dir()?.join("opencode").join("service.json"))
}

/// 把「监听所有接口」的绑定地址归一化成可连接的地址。
///
/// `0.0.0.0` / `[::]` 是 bind 地址，不是可用的连接目标：Chromium（WebView2/WKWebView）
/// 会拒绝发往 `0.0.0.0` 的请求（非路由地址），这里统一改写成回环——
/// 绑 0.0.0.0 时回环必然可达。后台服务注册表里的 URL 来自 `opencode serve
/// --hostname 0.0.0.0`，必须经过这一步，否则整个桌面端都在用不可连接的地址
/// （issue #181：本地服务的终端建不起来）。
pub fn connectable_url(url: &str) -> String {
    let normalized = url
        .replace("http://0.0.0.0:", "http://127.0.0.1:")
        .replace("https://0.0.0.0:", "https://127.0.0.1:")
        .replace("http://[::]:", "http://[::1]:")
        .replace("https://[::]:", "https://[::1]:");
    normalized.trim_end_matches('/').to_string()
}

pub fn read_registration() -> Option<ServiceRegistration> {
    let path = registration_path()?;
    let text = std::fs::read_to_string(path).ok()?;
    let mut registration: ServiceRegistration = serde_json::from_str(&text).ok()?;
    // 注册表里的 url 可能是 0.0.0.0（服务以 --hostname 0.0.0.0 启动），
    // 在这里一次性归一化，所有消费者（前端、探测、状态查询）都拿到可连接地址
    registration.url = connectable_url(&registration.url);
    Some(registration)
}

/// 探测注册表指向的服务是否就是注册的那个进程：/api/info 带 Basic 凭据，
/// 响应里的 pid 必须与注册表一致——排除「旧服务已死、端口被无关进程复用」
/// 的误认领。注册表缺 pid 的旧格式降级为「能连上即可」。
pub async fn probe_registration(registration: &ServiceRegistration) -> bool {
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .build()
    {
        Ok(client) => client,
        Err(_) => return false,
    };
    let mut request = client.get(format!(
        "{}/api/info",
        registration.url.trim_end_matches('/')
    ));
    if let Some(password) = registration.password.as_deref() {
        request = request.basic_auth("opencode", Some(password));
    }
    let response = match request.timeout(Duration::from_secs(5)).send().await {
        Ok(response) if response.status().is_success() => response,
        _ => return false,
    };
    let body: serde_json::Value = match response.text().await {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(value) => value,
            Err(_) => return false,
        },
        Err(_) => return false,
    };
    match (
        body.get("pid").and_then(|pid| pid.as_u64()),
        registration.pid,
    ) {
        (Some(actual), Some(expected)) => actual == expected as u64,
        _ => true,
    }
}

// ============================================
// 服务配置（P5：包 `opencode service set/unset/restart` CLI）
// ============================================

/// 设置页展示用的配置快照。直接读配置文件而非逐个 `service get`（省 5 次 CLI 启动）。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceConfigSnapshot {
    pub disabled: bool,
    /// remote 在新版是对象 { route }，早期版本是布尔 true——都视为开启
    pub remote: bool,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    /// 是否配置了固定密码（否则服务每次启动生成随机密码）
    pub fixed_password: bool,
    pub cors: Vec<String>,
    pub path: Option<String>,
}

#[tauri::command]
pub async fn opencode_service_config() -> Result<ServiceConfigSnapshot, String> {    let path = config_path();
    let text = path.as_ref().and_then(|p| std::fs::read_to_string(p).ok());    let value: serde_json::Value = text
        .as_deref()
        .and_then(|t| serde_json::from_str(t).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    Ok(ServiceConfigSnapshot {
        disabled: value.get("disabled").and_then(|v| v.as_bool()).unwrap_or(false),
        remote: value.get("remote").is_some(),
        hostname: value
            .get("hostname")
            .and_then(|v| v.as_str())
            .map(String::from),
        port: value
            .get("port")
            .and_then(|v| v.as_u64())
            .map(|v| v as u16),
        fixed_password: value
            .get("password")
            .and_then(|v| v.as_str())
            .is_some_and(|s| !s.is_empty()),
        cors: value
            .get("cors")
            .and_then(|v| v.as_array())
            .map(|list| {
                list.iter()
                    .filter_map(|origin| origin.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        path: path.map(|p| p.to_string_lossy().to_string()),
    })
}

/// set/unset 之后服务已变更多半伴随重启：重启后注册表里的 url 与
/// 随机密码都可能变，必须回传前端写回本机条目。
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceApplyResult {
    pub url: Option<String>,
    pub password: Option<String>,
    pub running: bool,
}

/// 运行 `opencode <args>` 等待结束（带超时）；非零退出带 stderr 摘要报错。
/// 复用 opencode.rs 的命令构造（Windows 下 .cmd/.bat 需要 cmd.exe 包装）。
pub(crate) async fn run_cli(
    binary_path: &str,
    args: &[&str],
    env_vars: &HashMap<String, String>,
    timeout: Duration,
) -> Result<String, String> {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let mut cmd = super::opencode::build_opencode_command(binary_path, &owned);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    for (key, value) in env_vars {
        cmd.env(key, value);
    }
    let mut tokio_cmd = tokio::process::Command::from(cmd);
    let child = tokio_cmd
        .spawn()
        .map_err(|e| format!("Failed to run '{}': {}", binary_path, e))?;
    let output = tokio::time::timeout(timeout, child.wait_with_output())
        .await
        .map_err(|_| format!("opencode {} timed out", args.join(" ")))
        .and_then(|r| r.map_err(|e| e.to_string()))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let summary: String = stderr.lines().take(4).collect::<Vec<_>>().join(" | ");
        return Err(format!(
            "opencode {} failed ({}): {}",
            args.join(" "),
            output.status,
            summary
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// `service set/unset` 只停服务不拉起（官方语义），这里补 `service restart`
/// （= stop + ensure，阻塞到就绪）再读注册表回传最新连接信息。
async fn restart_and_collect(
    binary_path: &str,
    env_vars: &HashMap<String, String>,
) -> Result<ServiceApplyResult, String> {
    run_cli(
        binary_path,
        &["service", "restart"],
        env_vars,
        Duration::from_secs(120),
    )
    .await?;
    let registration = read_registration();
    Ok(ServiceApplyResult {
        url: registration.as_ref().map(|r| r.url.clone()),
        password: registration.and_then(|r| r.password),
        running: true,
    })
}

const SETTABLE_KEYS: [&str; 5] = ["remote", "hostname", "port", "password", "cors"];
const UNSETTABLE_KEYS: [&str; 4] = ["hostname", "port", "password", "cors"];

#[tauri::command]
pub async fn opencode_service_set(
    binary_path: String,
    key: String,
    value: String,
    env_vars: HashMap<String, String>,
) -> Result<ServiceApplyResult, String> {
    if !SETTABLE_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported service config key: {key}"));
    }
    // remote=true 首次要签发通配符证书，分钟级（官方 ensure 上限 5 分钟，可续跑）
    let timeout = if key == "remote" && value == "true" {
        Duration::from_secs(360)
    } else {
        Duration::from_secs(60)
    };
    run_cli(
        &binary_path,
        &["service", "set", key.as_str(), value.as_str()],
        &env_vars,
        timeout,
    )
    .await?;
    restart_and_collect(&binary_path, &env_vars).await
}

#[tauri::command]
pub async fn opencode_service_unset(
    binary_path: String,
    key: String,
    env_vars: HashMap<String, String>,
) -> Result<ServiceApplyResult, String> {
    if !UNSETTABLE_KEYS.contains(&key.as_str()) {
        return Err(format!("Unsupported service config key: {key}"));
    }
    // remote 不提供 unset——官方语义里 set remote false 会忘掉隧道地址
    //（重新开启会签新地址），unset 语义不同，UI 也不暴露。
    run_cli(
        &binary_path,
        &["service", "unset", key.as_str()],
        &env_vars,
        Duration::from_secs(60),
    )
    .await?;
    restart_and_collect(&binary_path, &env_vars).await
}

/// 当前条目连的是否是「可管理的后台服务」（注册表存在且探测通过）。
/// 前端用它决定「停止服务」按钮是否可用——认领的服务不是本会话 spawn 的
/// （startedByUs=false），但同样可以被 ocui 管理。
#[tauri::command]
pub async fn get_service_managed() -> Result<bool, String> {
    match read_registration() {
        Some(registration) => Ok(probe_registration(&registration).await),
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::{config_dir_from, connectable_url, state_dir_from, ServiceRegistration};
    use std::path::PathBuf;

    #[test]
    fn connectable_url_rewrites_unspecified_bind_address() {
        // 绑 0.0.0.0 的服务注册表 URL 必须改写成回环，否则前端拿着不可连接的地址
        assert_eq!(connectable_url("http://0.0.0.0:49374"), "http://127.0.0.1:49374");
        assert_eq!(connectable_url("https://[::]:4096/"), "https://[::1]:4096");
        // 已经是可连接地址的保持不变（含去掉尾斜杠）
        assert_eq!(connectable_url("http://127.0.0.1:49374/"), "http://127.0.0.1:49374");
        assert_eq!(
            connectable_url("http://192.168.1.5:4096"),
            "http://192.168.1.5:4096"
        );
    }

    #[test]
    fn parses_full_registration() {
        let registration: ServiceRegistration = serde_json::from_str(
            r#"{"id":"srv_1","version":"2.0.29","pid":1234,"url":"http://127.0.0.1:49374","password":"pw"}"#,
        )
        .expect("full registration parses");
        assert_eq!(registration.url, "http://127.0.0.1:49374");
        assert_eq!(registration.pid, Some(1234));
        assert_eq!(registration.password.as_deref(), Some("pw"));
    }

    #[test]
    fn parses_lenient_registration() {
        // 旧格式缺 id/version/pid/password 也要能解析
        let registration: ServiceRegistration =
            serde_json::from_str(r#"{"url":"http://127.0.0.1:49374"}"#).expect("minimal registration parses");
        assert_eq!(registration.pid, None);
        assert!(serde_json::from_str::<ServiceRegistration>(r#"{"pid":1234}"#).is_err());
        assert!(serde_json::from_str::<ServiceRegistration>("not json").is_err());
    }

    #[test]
    fn xdg_dirs_take_priority_over_home() {
        let home = Some(PathBuf::from("/home/user"));
        let xdg = Some(PathBuf::from("/xdg/state"));
        assert_eq!(
            state_dir_from(xdg, home.clone()),
            Some(PathBuf::from("/xdg/state"))
        );
        assert_eq!(
            state_dir_from(None, home.clone()),
            Some(PathBuf::from("/home/user/.local/state"))
        );
        let xdg_config = Some(PathBuf::from("/xdg/config"));
        assert_eq!(
            config_dir_from(xdg_config, home.clone()),
            Some(PathBuf::from("/xdg/config"))
        );
        assert_eq!(
            config_dir_from(None, home),
            Some(PathBuf::from("/home/user/.config"))
        );
        assert_eq!(state_dir_from(None, None), None);
    }
}
