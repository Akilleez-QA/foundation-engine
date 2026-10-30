//! Bounded Moore-8 smoothing over two host-owned byte planes; GPL-3.0-only.
#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

unsafe extern "C" {
    static __heap_base: u8;
}

/// Returns 0 on success, 1 for invalid arguments (without writing).
/// Planes must be distinct, within imported memory, and above linker storage.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn smooth_chunk(
    input: u32,
    output: u32,
    width: u32,
    height: u32,
    start: u32,
    end: u32,
    birth: u32,
    survive: u32,
) -> u32 {
    let count = (width as u64) * (height as u64);
    let memory_end = (core::arch::wasm32::memory_size(0) as u64) * 65536;
    let heap_base = core::ptr::addr_of!(__heap_base) as u32;
    let input_end = input as u64 + count;
    let output_end = output as u64 + count;
    if width == 0
        || height == 0
        || width > i32::MAX as u32
        || height > i32::MAX as u32
        || count > u32::MAX as u64
        || start > end
        || end as u64 > count
        || end - start > 4096
        || birth > 9
        || survive > 9
        || input < heap_base
        || output < heap_base
        || input_end > memory_end
        || output_end > memory_end
        || ((input as u64) < output_end && (output as u64) < input_end)
    {
        return 1;
    }
    for i in start..end {
        let x = (i % width) as i32;
        let z = (i / width) as i32;
        let mut neighbors = 0u32;
        for dz in -1i32..=1 {
            for dx in -1i32..=1 {
                if dx == 0 && dz == 0 {
                    continue;
                }
                let nx = x + dx;
                let nz = z + dz;
                if nx < 0 || nz < 0 || nx >= width as i32 || nz >= height as i32 {
                    neighbors += 1;
                } else {
                    neighbors += unsafe { *((input + nz as u32 * width + nx as u32) as *const u8) } as u32;
                }
            }
        }
        let threshold = if unsafe { *((input + i) as *const u8) } != 0 { survive } else { birth };
        unsafe { *((output + i) as *mut u8) = (neighbors >= threshold) as u8; }
    }
    0
}
