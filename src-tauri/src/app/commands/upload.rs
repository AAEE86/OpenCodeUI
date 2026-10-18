// ============================================
// 附件上传（Issue #182）：Rust 侧流式发送 + 进度事件
//
// 为什么不在 webview 里用 XHR：桌面端 webview 的跨源请求受 CORS / 私有网络
// 策略约束，不可靠；而经 tauri-plugin-http 的 fetch 又拿不到上传进度。
// 这里由 Rust 直接发请求：
//   - 不受 webview 的同源策略限制（请求由 Rust 进程发出）
//   - 边读文件边发（`Body::wrap_stream`，chunked），不把整份文件读进内存
//   - 每读一块就通过 Channel 推一次进度
//
// 服务端契约（已在真实 2.0.29 服务端验证）：
//   - `POST /api/experimental/fs/write?path=<目标>&location[directory]=<目录>`
//   - body 为原始字节；**接受 chunked**（无 Content-Length 也可以）
//   - 200 返回 `{ data: { path } }`，path 是服务端规范化后的绝对路径
//   - 密码走 Basic（用户名固定 opencode）
// ============================================

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;
use tokio_util::io::ReaderStream;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum UploadEvent {
    Progress { loaded: u64, total: u64 },
}

#[derive(Serialize)]
pub struct UploadResult {
    pub path: String,
    pub size: u64,
}

/// 把本机文件流式上传到服务端临时目录，返回服务端返回的规范化路径。
///
/// 错误文案与前端 `classifyUploadFailure` 的识别规则对齐：
/// - `Upload failed: network error (...)` → network
/// - `Upload failed with status 401/403/5xx` → unauthorized / server
#[tauri::command]
pub async fn upload_attachment(
    url: String,
    target: String,
    source_path: String,
    password: Option<String>,
    directory: Option<String>,
    on_event: Channel<UploadEvent>,
) -> Result<UploadResult, String> {
    let size = tokio::fs::metadata(&source_path)
        .await
        .map_err(|e| format!("Cannot read local file: {e}"))?
        .len();

    let file = tokio::fs::File::open(&source_path)
        .await
        .map_err(|e| format!("Cannot read local file: {e}"))?;

    let loaded = Arc::new(AtomicU64::new(0));
    let stream = ReaderStream::new(file).map({
        let loaded = Arc::clone(&loaded);
        let on_event = on_event.clone();
        move |chunk| {
            if let Ok(bytes) = &chunk {
                let sent = loaded.fetch_add(bytes.len() as u64, Ordering::Relaxed) + bytes.len() as u64;
                // 进度发失败（窗口已关）不影响上传本身
                let _ = on_event.send(UploadEvent::Progress {
                    loaded: sent,
                    total: size,
                });
            }
            chunk
        }
    });

    let mut endpoint =
        reqwest::Url::parse(&format!("{}/api/experimental/fs/write", url.trim_end_matches('/')))
            .map_err(|e| format!("Invalid server url: {e}"))?;
    {
        let mut query = endpoint.query_pairs_mut();
        query.append_pair("path", &target);
        if let Some(directory) = directory.as_deref().filter(|value| !value.is_empty()) {
            query.append_pair("location[directory]", directory);
        }
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let mut request = client
        .post(endpoint)
        .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
        .body(reqwest::Body::wrap_stream(stream));

    if let Some(password) = password.as_deref().filter(|value| !value.is_empty()) {
        request = request.basic_auth("opencode", Some(password));
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Upload failed: network error ({e})"))?;
    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        return Err(format!("Upload failed with status {}", status.as_u16()));
    }

    let parsed: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("Invalid upload response: {e}"))?;
    let path = parsed
        .get("data")
        .and_then(|data| data.get("path"))
        .and_then(|path| path.as_str())
        .unwrap_or(&target)
        .to_string();

    // 收尾补一个 100%，避免最后一个分块事件被合并掉时进度停在 99%
    let _ = on_event.send(UploadEvent::Progress {
        loaded: size,
        total: size,
    });

    Ok(UploadResult { path, size })
}
