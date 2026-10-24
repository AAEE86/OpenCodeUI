//! DXGI 桌面复制。
//!
//! GDI 抓屏每帧要把整块屏幕像素拷回 CPU（实测 11–15ms），
//! 而桌面在合成器里本来就是一帧 GPU 纹理，DXGI 直接拿。
//! 这里只把「窗口那一块」复制到一张 staging 纹理上回读，
//! 不碰整屏，也不缩放（缩放和模糊交给后面的 CPU 那一步，那一步才 1.5ms）。

#[cfg(target_os = "windows")]
pub mod dxgi {
    use windows::core::Interface;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, D3D_FEATURE_LEVEL_11_0};
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ,
        D3D11_MAPPED_SUBRESOURCE, D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING,
        D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext, ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::{
        DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO,
        IDXGIDevice, IDXGIOutput1, IDXGIOutputDuplication, IDXGIResource,
    };

    pub struct Duplication {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        dup: IDXGIOutputDuplication,
        /// 该输出在虚拟桌面里的左上角
        offset: (i32, i32),
        /// 该输出的像素尺寸
        size: (u32, u32),
        staging: Option<(ID3D11Texture2D, u32, u32)>,
    }

    impl Duplication {
        /// 按窗口中心所在的显示器建复制。
        pub fn new_for_point(point_x: i32, point_y: i32) -> Result<Self, String> {
            unsafe {
                let mut device: Option<ID3D11Device> = None;
                let mut context: Option<ID3D11DeviceContext> = None;
                D3D11CreateDevice(
                    None,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    Some(&[D3D_FEATURE_LEVEL_11_0]),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )
                .map_err(|err| format!("D3D11CreateDevice: {err}"))?;
                let device = device.ok_or("没有拿到 D3D11 设备")?;
                let context = context.ok_or("没有拿到 D3D11 上下文")?;
                let dxgi_device: IDXGIDevice = device.cast().map_err(|err| err.to_string())?;
                let adapter = dxgi_device.GetAdapter().map_err(|err| err.to_string())?;

                let mut chosen = None;
                let mut index = 0;
                while let Ok(output) = adapter.EnumOutputs(index) {
                    if let Ok(desc) = output.GetDesc() {
                        let r = desc.DesktopCoordinates;
                        if point_x >= r.left && point_x < r.right && point_y >= r.top && point_y < r.bottom {
                            chosen = Some(output);
                            break;
                        }
                    }
                    index += 1;
                }
                let output = chosen.ok_or("没找到窗口所在的显示器")?;
                let desc = output.GetDesc().map_err(|err| err.to_string())?;
                let output1: IDXGIOutput1 = output.cast().map_err(|err| err.to_string())?;
                let dup = output1
                    .DuplicateOutput(&device)
                    .map_err(|err| format!("DuplicateOutput: {err}"))?;
                let rect = desc.DesktopCoordinates;
                Ok(Self {
                    device,
                    context,
                    dup,
                    offset: (rect.left, rect.top),
                    size: ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32),
                    staging: None,
                })
            }
        }

        #[allow(dead_code)]
        pub fn new() -> Result<Self, String> {
            unsafe {
                let mut device: Option<ID3D11Device> = None;
                let mut context: Option<ID3D11DeviceContext> = None;
                D3D11CreateDevice(
                    None,
                    D3D_DRIVER_TYPE_HARDWARE,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    Some(&[D3D_FEATURE_LEVEL_11_0]),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )
                .map_err(|err| format!("D3D11CreateDevice: {err}"))?;
                let device = device.ok_or("没有拿到 D3D11 设备")?;
                let context = context.ok_or("没有拿到 D3D11 上下文")?;

                let dxgi_device: IDXGIDevice = device.cast().map_err(|err| err.to_string())?;
                let adapter = dxgi_device.GetAdapter().map_err(|err| err.to_string())?;
                let output = adapter.EnumOutputs(0).map_err(|err| err.to_string())?;
                let desc = output.GetDesc().map_err(|err| err.to_string())?;
                let output1: IDXGIOutput1 = output.cast().map_err(|err| err.to_string())?;
                let dup = output1
                    .DuplicateOutput(&device)
                    .map_err(|err| format!("DuplicateOutput: {err}"))?;

                let rect = desc.DesktopCoordinates;
                Ok(Self {
                    device,
                    context,
                    dup,
                    offset: (rect.left, rect.top),
                    size: ((rect.right - rect.left) as u32, (rect.bottom - rect.top) as u32),
                    staging: None,
                })
            }
        }

        pub fn size(&self) -> (u32, u32) {
            self.size
        }

        pub fn offset(&self) -> (i32, i32) {
            self.offset
        }

        /// 抓一块区域，返回 BGRA 字节（每行紧密排列）和**实际**尺寸。
        ///
        /// 请求的区域可能有一部分在屏幕外（最大化窗口就是 -8,-8 起），
        /// 这里会裁剪，所以返回的宽高可能比请求的小——调用方必须用返回值，
        /// 不能拿请求尺寸当图的实际大小。
        /// `Ok(None)` 表示这一帧桌面没变（或暂时拿不到帧），调用方沿用上一帧。
        pub fn grab(
            &mut self,
            left: i32,
            top: i32,
            width: u32,
            height: u32,
        ) -> Result<Option<(Vec<u8>, u32, u32)>, String> {
            if width == 0 || height == 0 {
                return Ok(None);
            }
            unsafe {
                let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource: Option<IDXGIResource> = None;
                match self.dup.AcquireNextFrame(0, &mut info, &mut resource) {
                    Ok(()) => {}
                    Err(err) if err.code() == DXGI_ERROR_WAIT_TIMEOUT || err.code() == DXGI_ERROR_ACCESS_LOST => {
                        return Ok(None);
                    }
                    Err(err) => return Err(format!("AcquireNextFrame: {err}")),
                }

                let result = (|| -> Result<Option<(Vec<u8>, u32, u32)>, String> {
                    let resource = resource.ok_or("没有拿到桌面资源")?;
                    let texture: ID3D11Texture2D = resource.cast().map_err(|err| err.to_string())?;

                    // 窗口坐标 → 该输出的本地坐标
                    let x = left - self.offset.0;
                    let y = top - self.offset.1;
                    let x0 = x.clamp(0, self.size.0 as i32);
                    let y0 = y.clamp(0, self.size.1 as i32);
                    let x1 = (x + width as i32).clamp(0, self.size.0 as i32);
                    let y1 = (y + height as i32).clamp(0, self.size.1 as i32);
                    let copy_w = (x1 - x0) as u32;
                    let copy_h = (y1 - y0) as u32;
                    if copy_w == 0 || copy_h == 0 {
                        return Ok(None);
                    }

                    let staging = self.staging_texture(copy_w, copy_h)?;
                    let region = D3D11_BOX {
                        left: x0 as u32,
                        top: y0 as u32,
                        front: 0,
                        right: x1 as u32,
                        bottom: y1 as u32,
                        back: 1,
                    };
                    self.context.CopySubresourceRegion(
                        &staging,
                        0,
                        0,
                        0,
                        0,
                        &texture,
                        0,
                        Some(&region),
                    );

                    let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
                    self.context
                        .Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                        .map_err(|err| format!("Map: {err}"))?;
                    let mut out = Vec::with_capacity((copy_w * copy_h * 4) as usize);
                    for row in 0..copy_h {
                        let src = (mapped.pData as *const u8).add((row * mapped.RowPitch) as usize);
                        out.extend_from_slice(std::slice::from_raw_parts(src, (copy_w * 4) as usize));
                    }
                    let _ = self.context.Unmap(&staging, 0);
                    Ok(Some((out, copy_w, copy_h)))
                })();

                let _ = self.dup.ReleaseFrame();
                result
            }
        }

        fn staging_texture(&mut self, w: u32, h: u32) -> Result<ID3D11Texture2D, String> {
            if let Some((texture, sw, sh)) = &self.staging {
                if *sw == w && *sh == h {
                    return Ok(texture.clone());
                }
            }
            let desc = D3D11_TEXTURE2D_DESC {
                Width: w,
                Height: h,
                MipLevels: 1,
                ArraySize: 1,
                Format: windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
                SampleDesc: windows::Win32::Graphics::Dxgi::Common::DXGI_SAMPLE_DESC {
                    Count: 1,
                    Quality: 0,
                },
                Usage: D3D11_USAGE_STAGING,
                BindFlags: 0,
                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                MiscFlags: 0,
            };
            let mut texture: Option<ID3D11Texture2D> = None;
            unsafe {
                self.device
                    .CreateTexture2D(&desc, None, Some(&mut texture))
                    .map_err(|err| format!("CreateTexture2D: {err}"))?;
            }
            let texture = texture.ok_or("建 staging 纹理失败")?;
            self.staging = Some((texture.clone(), w, h));
            Ok(texture)
        }
    }
}

#[cfg(all(test, target_os = "windows"))]
mod probe {
    use std::time::{Duration, Instant};

    #[test]
    #[ignore]
    fn dxgi_bench() {
        let mut dup = match super::dxgi::Duplication::new() {
            Ok(d) => d,
            Err(err) => {
                println!("dxgi unavailable: {err}");
                return;
            }
        };
        println!("output size = {:?}", dup.size());

        // 抓一块 1600x1000，跑 2 秒，统计拿到帧的耗时
        let mut grabbed = 0;
        let mut total = Duration::ZERO;
        let mut bytes = 0usize;
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(2) {
            let t = Instant::now();
            match dup.grab(0, 0, 1600, 1000) {
                Ok(Some((px, _, _))) => {
                    total += t.elapsed();
                    bytes = px.len();
                    grabbed += 1;
                }
                Ok(None) => {}
                Err(err) => {
                    println!("grab error: {err}");
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(8));
        }
        if grabbed > 0 {
            println!(
                "grabbed {grabbed} frames in {:?}, avg {:?}/frame, {:.1} MB/frame",
                started.elapsed(),
                total / grabbed,
                bytes as f64 / 1024.0 / 1024.0
            );
        } else {
            println!("no frames grabbed (desktop static?)");
        }
    }
}
