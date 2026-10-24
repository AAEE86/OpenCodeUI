//! 桌面背景抓取。
//!
//! 玻璃外观要“窗口背后那张图”，但 WebView2 的 backdrop-filter 采不到窗口外，
//! 所以只能把窗口背后那块桌面抓下来，缩到很小的尺寸交给页面当底图。
//! 页面拿到的是页面内的图片，我们自己的材质就能正常糊它。
//!
//! 抓取走 DXGI 桌面复制：桌面在合成器里本来就是一帧 GPU 纹理，
//! 只把窗口那一块复制回 CPU，比 GDI 整屏读回快一个数量级（2ms vs 12ms）。
//!
//! 把自己排除出捕获这件事不在这里做，由档位开关统一管（见 window_backdrop.rs）：
//! 那个标记要等 DWM 重新合成一帧才生效，逐帧开关会一帧干净一帧带影子。

#[tauri::command]
pub fn capture_desktop_backdrop(
    window: tauri::WebviewWindow,
    width: u32,
    height: u32,
    margin: u32,
    toggle: bool,
) -> Result<tauri::ipc::Response, String> {
    #[cfg(target_os = "windows")]
    {
        let hwnd = window.hwnd().map_err(|err| err.to_string())?;
        let raw = hwnd.0 as *mut std::ffi::c_void;
        // 这条命令跑在 WebView2 的 COM 回调里，panic 没法 unwind，会直接把进程带走。
        // 兜一层，任何内部错误都退化成「这一帧没变」。
        let frame = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            windows_capture::grab(raw, width, height, margin, toggle)
        }))
        .unwrap_or_else(|_| {
            log::error!("[backdrop] 抓屏内部异常");
            Err("抓屏内部异常".to_string())
        })?;
        return Ok(tauri::ipc::Response::new(frame));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, width, height, margin, toggle);
        Err("只有 Windows 支持抓取桌面背景".into())
    }
}

#[cfg(target_os = "windows")]
mod windows_capture {
    use std::ffi::c_void;
    use std::sync::Mutex;

    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic, IsWindowVisible};

    use super::super::backdrop_dxgi::dxgi::Duplication;

    /// 抓窗口背后那块桌面，缩到 `width` × `height` 的 RGBA。
    /// 返回 1 字节表示这一帧桌面没变，页面不用重绘。
    pub fn grab(
        hwnd: *mut c_void,
        width: u32,
        height: u32,
        margin: u32,
        toggle: bool,
    ) -> Result<Vec<u8>, String> {
        if width == 0 || height == 0 || width > 4096 || height > 4096 {
            return Err("目标尺寸不合法".into());
        }
        let hwnd = HWND(hwnd);

        // 最小化 / 隐藏时抓到的是一团垃圾，直接让前端沿用上一帧
        if !unsafe { IsWindowVisible(hwnd).as_bool() } || unsafe { IsIconic(hwnd).as_bool() } {
            return Err("窗口不可见".into());
        }

        let mut rect = windows::Win32::Foundation::RECT::default();
        // SAFETY: hwnd 来自当前 Tauri 窗口，调用期间有效
        unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|err| err.to_string())?;
        let src_w = rect.right - rect.left;
        let src_h = rect.bottom - rect.top;
        if src_w <= 0 || src_h <= 0 {
            return Err("窗口尺寸为 0".into());
        }
        // 往外多抓一圈：页面那层模糊的边缘会往外扩散，
        // 抓满这一圈，模糊的衰减就落在窗口外面，画面保持 1:1 不用放大。
        let margin = margin as i32;
        let left = rect.left - margin;
        let top = rect.top - margin;
        let grab_w = src_w + margin * 2;
        let grab_h = src_h + margin * 2;

        // toggle = true：只在抓这一瞬排除自己，抓完恢复可见（能截图能录屏，但要等一帧合成）
        // toggle = false：排除标记已经由窗口模式常驻，这里直接抓（能跑满帧率）
        if toggle {
            set_exclusion(hwnd, true);
            dwm_flush();
        }
        let grabbed = capture_region(left, top, grab_w, grab_h);
        if toggle {
            set_exclusion(hwnd, false);
        }

        let t0 = std::time::Instant::now();
        let Some((bgra, cap_w, cap_h)) = grabbed? else {
            return Ok(vec![0u8]);
        };
        let t_grab = t0.elapsed();
        let pixels = downscale(&bgra, cap_w, cap_h, width, height);
        let t_scale = t0.elapsed();

        if !mark_changed(&pixels) {
            return Ok(vec![0u8]);
        }
        log_cost(src_w, src_h, width, height, t_grab, t_scale - t_grab);
        Ok(pixels)
    }

    fn set_exclusion(hwnd: HWND, excluded: bool) {
        #[link(name = "user32")]
        extern "system" {
            fn SetWindowDisplayAffinity(hwnd: *mut c_void, affinity: u32) -> i32;
        }
        const WDA_NONE: u32 = 0;
        const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
        let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        let _ = unsafe { SetWindowDisplayAffinity(hwnd.0, affinity) };
    }

    /// 等 DWM 完成一次合成。标记生效需要一帧，不等就会抓到上一帧。
    fn dwm_flush() {
        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmFlush() -> i32;
        }
        let _ = unsafe { DwmFlush() };
    }

    /// 用 DXGI 抓窗口那块区域。`None` 表示桌面这一帧没变。
    fn capture_region(
        left: i32,
        top: i32,
        width: i32,
        height: i32,
    ) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
        static DUP: Mutex<Option<Duplication>> = Mutex::new(None);

        let mut guard = DUP.lock().map_err(|_| "捕获状态锁坏了".to_string())?;
        let cx = left + width / 2;
        let cy = top + height / 2;
        // 窗口换显示器 / 分辨率变了就重建
        let need_rebuild = match guard.as_ref() {
            Some(dup) => {
                let (ox, oy) = dup.offset();
                let (ow, oh) = dup.size();
                cx < ox || cy < oy || cx >= ox + ow as i32 || cy >= oy + oh as i32
            }
            None => true,
        };
        if need_rebuild {
            *guard = Some(Duplication::new_for_point(cx, cy)?);
        }
        let Some(dup) = guard.as_mut() else {
            return Ok(None);
        };

        match dup.grab(left, top, width as u32, height as u32) {
            Ok(frame) => Ok(frame),
            Err(err) => {
                // 分辨率切换、显示器热插拔之后会 ACCESS_LOST，丢掉重建
                *guard = None;
                Err(err)
            }
        }
    }

    /// 最近邻缩小 + BGRA → RGBA。后面还有一道盒式模糊，锯齿会被抹平。
    fn downscale(bgra: &[u8], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<u8> {
        let mut out = vec![0u8; (dw * dh * 4) as usize];
        if sw == 0 || sh == 0 || dw == 0 || dh == 0 {
            return out;
        }
        // 防御：尺寸对不上时不要越界（这个 panic 会把整个进程带崩）
        if bgra.len() < (sw as usize * sh as usize * 4) {
            return out;
        }
        for y in 0..dh {
            let sy = (y as u64 * sh as u64 / dh as u64) as u32;
            let src_row = (sy * sw) as usize;
            let dst_row = (y * dw) as usize;
            for x in 0..dw {
                let sx = (x as u64 * sw as u64 / dw as u64) as usize;
                let si = (src_row + sx) * 4;
                let di = (dst_row + x as usize) * 4;
                out[di] = bgra[si + 2];
                out[di + 1] = bgra[si + 1];
                out[di + 2] = bgra[si];
                out[di + 3] = 255;
            }
        }
        out
    }

    /// 每 120 帧打一条耗时，定位延迟落在哪一段
    fn log_cost(src_w: i32, src_h: i32, w: u32, h: u32, grab: std::time::Duration, scale: std::time::Duration) {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        if n % 120 == 0 {
            log::info!(
                "[backdrop] src={src_w}x{src_h} -> {w}x{h} grab={:?} scale={:?}",
                grab,
                scale
            );
        }
    }

    /// 上一帧的像素，用来判断画面有没有变。变了才发 IPC，没变就发哨兵。
    fn mark_changed(pixels: &[u8]) -> bool {
        static LAST: Mutex<Vec<u8>> = Mutex::new(Vec::new());
        let Ok(mut last) = LAST.lock() else {
            return true;
        };
        if last.as_slice() == pixels {
            return false;
        }
        last.clear();
        last.extend_from_slice(pixels);
        true
    }
}
