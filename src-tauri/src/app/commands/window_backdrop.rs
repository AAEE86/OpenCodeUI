//! 窗口背景模式。
//!
//! 玻璃外观在桌面端有三种底：
//!
//! - `native`：窗口透明，底图交给系统材质（DWM acrylic）。
//! - `page`：窗口不透明，页面自己画背景（跟着桌面的抓屏、或用户选的壁纸）。
//! - `none`：不透明兜底色，没有玻璃底。
//!
//! `page` 模式必须把 WebView2 的背景色设成不透明：窗口背景透明时
//! Chromium 建不出 backdrop root，页面里所有 `backdrop-filter` 都会静默失效，
//! 弹窗和菜单就只剩一层色。这也是之前 dialog 一直没质感的原因。


/// 当前窗口是否挂着系统材质，用于首帧后补一次。
#[cfg(target_os = "windows")]
static GLASS_ENABLED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// DWM 材质调用。
///
/// 不用 window_vibrancy 是有原因的：它在 Win11 上只要系统版本够就返回 Ok，
/// 根本不看 DwmSetWindowAttribute 的结果，前端因此误以为材质挂上了。
/// 这里自己调，把 HRESULT 记下来，挂没挂上一看日志就知道。
#[cfg(target_os = "windows")]
mod dwm {
    use std::ffi::c_void;

    #[repr(C)]
    struct Margins {
        cx_left_width: i32,
        cx_right_width: i32,
        cy_top_height: i32,
        cy_bottom_height: i32,
    }

    #[repr(C)]
    struct BlurBehind {
        flags: u32,
        enable: i32,
        blur_region: *mut c_void,
        transition_on_maximized: i32,
    }

    const DWM_BB_ENABLE: u32 = 0x1;
    const DWMWA_SYSTEMBACKDROP_TYPE: u32 = 38;
    /// 1 = 关，2 = Mica（只取壁纸），3 = Acrylic（连后面窗口一起糊），4 = Tabbed
    const DWMSBT_NONE: i32 = 1;
    const DWMSBT_TRANSIENTWINDOW: i32 = 3;

    #[link(name = "user32")]
    extern "system" {
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
    }

    const GWL_STYLE: i32 = -16;
    /// WS_CAPTION = WS_BORDER | WS_DLGFRAME
    const WS_CAPTION: isize = 0x00C0_0000;

    /// 去掉窗口的标题栏样式。
    ///
    /// 我们把 DWM 边框扩到了整个客户区，只要窗口还带 WS_CAPTION，
    /// DWM 就会在客户区里画原生标题栏（最小化/最大化/关闭）。
    /// 玻璃下标题栏是透明的，这三个按钮就从背后透出来，看着像多了一套。
    fn strip_caption(hwnd: *mut c_void) {
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
            if style & WS_CAPTION != 0 {
                SetWindowLongPtrW(hwnd, GWL_STYLE, style & !WS_CAPTION);
                log::info!("[window] stripped WS_CAPTION: {style:#x} -> {:#x}", style & !WS_CAPTION);
            }
        }
    }

    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(
            hwnd: *mut c_void,
            attribute: u32,
            value: *const c_void,
            size: u32,
        ) -> i32;
        fn DwmExtendFrameIntoClientArea(hwnd: *mut c_void, margins: *const Margins) -> i32;
        fn DwmEnableBlurBehindWindow(hwnd: *mut c_void, data: *const BlurBehind) -> i32;
    }

    fn backdrop(hwnd: *mut c_void, kind: i32) -> i32 {
        unsafe {
            DwmSetWindowAttribute(
                hwnd,
                DWMWA_SYSTEMBACKDROP_TYPE,
                &kind as *const _ as *const c_void,
                std::mem::size_of::<i32>() as u32,
            )
        }
    }

    pub fn apply(hwnd: *mut c_void) -> bool {
        strip_caption(hwnd);
        // tao 为了做全透明，给窗口挂过旧的 blur-behind（空模糊区）。
        // 那个状态和系统材质互斥，先关掉，否则材质永远不会出现。
        let blur_off = BlurBehind {
            flags: DWM_BB_ENABLE,
            enable: 0,
            blur_region: std::ptr::null_mut(),
            transition_on_maximized: 0,
        };
        let clear = unsafe { DwmEnableBlurBehindWindow(hwnd, &blur_off) };

        // 材质画在 DWM 边框里，无装饰窗口不扩这一下就没地方落笔
        let margins = Margins {
            cx_left_width: -1,
            cx_right_width: -1,
            cy_top_height: -1,
            cy_bottom_height: -1,
        };
        let extend = unsafe { DwmExtendFrameIntoClientArea(hwnd, &margins) };

        let applied = backdrop(hwnd, DWMSBT_TRANSIENTWINDOW);
        log::info!(
            "[window] dwm acrylic: blur-behind={clear:#x} extend-frame={extend:#x} backdrop={applied:#x}"
        );
        applied == 0
    }

    pub fn clear(hwnd: *mut c_void) {
        let result = backdrop(hwnd, DWMSBT_NONE);
        log::info!("[window] dwm backdrop cleared: {result:#x}");
    }
}

/// 开关「窗口是否参与屏幕捕获」。
///
/// 自绘档要靠抓屏当背景，抓的时候必须把自己摘掉；但这个标记要等 DWM
/// 重新合成一帧才生效，逐帧开关会一帧干净一帧带影子（看起来在闪），
/// 所以它跟着档位常驻。代价：自绘档开着的时候，应用不会出现在截图/录屏里。
#[cfg(target_os = "windows")]
fn set_capture_excluded(hwnd: *mut std::ffi::c_void, excluded: bool) {
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowDisplayAffinity(hwnd: *mut std::ffi::c_void, affinity: u32) -> i32;
    }
    const WDA_NONE: u32 = 0;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    let affinity = if excluded { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    let ok = unsafe { SetWindowDisplayAffinity(hwnd, affinity) };
    log::info!("[window] capture excluded={excluded} ({ok})");
}

/// 首帧之前窗口是隐藏的，材质可能没落到可见窗口上，这里补一次。
pub fn reapply_on_shown(window: &tauri::Window) {
    #[cfg(target_os = "windows")]
    if GLASS_ENABLED.load(std::sync::atomic::Ordering::Relaxed) {
        if let Ok(hwnd) = window.hwnd() {
            dwm::apply(hwnd.0 as *mut std::ffi::c_void);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

#[derive(Clone, Copy, PartialEq)]
pub enum BackdropMode {
    Native,
    Page,
    None,
}

impl BackdropMode {
    pub fn parse(value: &str) -> Self {
        match value {
            "native" => BackdropMode::Native,
            "page" => BackdropMode::Page,
            _ => BackdropMode::None,
        }
    }
}

fn parse_hex_color(value: &str) -> (u8, u8, u8) {
    let hex = value.trim_start_matches('#');
    if hex.len() < 6 {
        return (16, 16, 18);
    }
    let parse = |range: std::ops::Range<usize>| u8::from_str_radix(&hex[range], 16).unwrap_or(16);
    (parse(0..2), parse(2..4), parse(4..6))
}

/// 切换窗口背景模式，返回系统材质是否真的挂上（只有 `native` 有意义）。
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub fn set_window_backdrop(
    window: tauri::WebviewWindow,
    mode: String,
    color: String,
    exclude: bool,
) -> bool {
    let mode = BackdropMode::parse(&mode);
    let (r, g, b) = parse_hex_color(&color);

    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;

        let Ok(hwnd) = window.hwnd() else {
            log::warn!("[window] no hwnd, skip backdrop");
            return false;
        };
        let raw = hwnd.0 as *mut std::ffi::c_void;

        match mode {
            BackdropMode::Native => {
                set_capture_excluded(raw, false);
                GLASS_ENABLED.store(true, Ordering::Relaxed);
                let _ = window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)));
                let applied = dwm::apply(raw);
                log::info!("[window] backdrop=native acrylic({applied})");
                return applied;
            }
            BackdropMode::Page => {
                GLASS_ENABLED.store(false, Ordering::Relaxed);
                dwm::clear(raw);
                // 不透明的 webview 背景：让页面里的 backdrop-filter 重新工作
                let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
                // 抓屏期间把自己排除出捕获，否则抓到的是我们自己。
                // 常驻排除画面最干净，但这个窗口也就从所有截图/录屏里消失了；
                // 用户勾了「允许被录屏」时改由抓屏那一步临时排除。
                set_capture_excluded(raw, exclude);
                log::info!("[window] backdrop=page exclude={exclude}");
                return true;
            }
            BackdropMode::None => {
                GLASS_ENABLED.store(false, Ordering::Relaxed);
                dwm::clear(raw);
                let _ = window.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
                set_capture_excluded(raw, false);
                log::info!("[window] backdrop=none");
                return true;
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        use tauri::window::{Color, Effect, EffectsBuilder};
        match mode {
            BackdropMode::Native => {
                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                let applied = window
                    .set_effects(
                        EffectsBuilder::new()
                            .effect(Effect::UnderWindowBackground)
                            .build(),
                    )
                    .is_ok();
                log::info!("[window] backdrop=native vibrancy({applied})");
                return applied;
            }
            _ => {
                let _ = exclude;
                let _ = window.set_effects(None);
                let _ = window.set_background_color(Some(Color(r, g, b, 255)));
                return true;
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        let _ = exclude;
        let _ = window.set_background_color(Some(if mode == BackdropMode::Native {
            tauri::window::Color(0, 0, 0, 0)
        } else {
            tauri::window::Color(r, g, b, 255)
        }));
        true
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = (window, r, g, b, mode, exclude);
        false
    }
}
