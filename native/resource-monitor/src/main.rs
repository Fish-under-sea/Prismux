use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{self, BufRead, BufWriter, Write};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use sysinfo::{
    Components, CpuRefreshKind, MINIMUM_CPU_UPDATE_INTERVAL, MemoryRefreshKind, Pid,
    ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind,
};

#[cfg(target_os = "windows")]
mod win_mem {
    use std::ffi::c_void;
    use std::mem::{size_of, zeroed};

    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_COUNTERS: u32 = 3;

    #[repr(C)]
    struct ProcessMemoryCountersEx2 {
        cb: u32,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
        private_working_set_size: usize,
        shared_commit_usage: u64,
    }

    #[repr(C)]
    struct VmCountersEx {
        peak_virtual_size: usize,
        virtual_size: usize,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_usage: usize,
    }

    #[repr(C)]
    struct VmCountersEx2 {
        counters_ex: VmCountersEx,
        private_working_set_size: usize,
        shared_commit_usage: usize,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(
            desired_access: u32,
            inherit_handle: i32,
            process_id: u32,
        ) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
        fn K32GetProcessMemoryInfo(
            process: *mut c_void,
            ppsmemcounters: *mut ProcessMemoryCountersEx2,
            cb: u32,
        ) -> i32;
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQueryInformationProcess(
            process_handle: *mut c_void,
            process_information_class: u32,
            process_information: *mut c_void,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    struct HandleGuard(*mut c_void);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    /// Queries Windows Task Manager's "Memory (Private Working Set)" in bytes for `pid`,
    /// avoiding multi-process Chromium/Electron shared-page double counting.
    pub fn private_working_set_bytes(pid: u32) -> Option<u64> {
        if pid == 0 {
            return None;
        }
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let _guard = HandleGuard(handle);

        // Primary: Win32 PROCESS_MEMORY_COUNTERS_EX2.PrivateWorkingSetSize (Win10 20348+ / Win11).
        let mut ex2: ProcessMemoryCountersEx2 = unsafe { zeroed() };
        ex2.cb = size_of::<ProcessMemoryCountersEx2>() as u32;
        let ok = unsafe { K32GetProcessMemoryInfo(handle, &mut ex2, ex2.cb) };
        if ok != 0 && (ex2.private_working_set_size > 0 || ex2.working_set_size == 0) {
            return Some(ex2.private_working_set_size as u64);
        }

        // Universal fallback (Windows Vista+): NtQueryInformationProcess(ProcessVmCounters, VM_COUNTERS_EX2).
        let mut vm_ex2: VmCountersEx2 = unsafe { zeroed() };
        let mut return_length: u32 = 0;
        let status = unsafe {
            NtQueryInformationProcess(
                handle,
                PROCESS_VM_COUNTERS,
                (&mut vm_ex2 as *mut VmCountersEx2).cast::<c_void>(),
                size_of::<VmCountersEx2>() as u32,
                &mut return_length,
            )
        };
        if status >= 0
            && (vm_ex2.private_working_set_size > 0 || vm_ex2.counters_ex.working_set_size == 0)
        {
            return Some(vm_ex2.private_working_set_size as u64);
        }

        None
    }
}

#[cfg(target_os = "windows")]
mod win_proc {
    use std::ffi::c_void;
    use std::mem::size_of;

    const SYSTEM_PROCESS_INFORMATION_CLASS: u32 = 5;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_COMMAND_LINE_INFORMATION: u32 = 60;
    const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004_u32 as i32;
    const STATUS_BUFFER_OVERFLOW: i32 = 0x8000_0005_u32 as i32;
    const STATUS_BUFFER_TOO_SMALL: i32 = 0xC000_0023_u32 as i32;
    // 100ns ticks between 1601-01-01 (Windows FILETIME epoch) and 1970-01-01 (Unix epoch).
    const WINDOWS_EPOCH_OFFSET_100NS: i64 = 116_444_736_000_000_000;
    const INITIAL_BUFFER_BYTES: usize = 512 * 1024;
    const MAX_BUFFER_BYTES: usize = 64 * 1024 * 1024;
    const MAX_CMD_BUFFER_BYTES: usize = 256 * 1024;

    #[repr(C)]
    #[derive(Debug, Clone, Copy)]
    struct UnicodeString {
        length: u16,
        maximum_length: u16,
        buffer: *const u16,
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct SystemProcessInformation {
        next_entry_offset: u32,
        number_of_threads: u32,
        working_set_private_size: i64,
        hard_fault_count: u32,
        number_of_threads_high_watermark: u32,
        cycle_time: u64,
        create_time: i64,
        user_time: i64,
        kernel_time: i64,
        image_name: UnicodeString,
        base_priority: i32,
        unique_process_id: *mut c_void,
        inherited_from_unique_process_id: *mut c_void,
        handle_count: u32,
        session_id: u32,
        unique_process_key: usize,
        peak_virtual_size: usize,
        virtual_size: usize,
        page_fault_count: u32,
        peak_working_set_size: usize,
        working_set_size: usize,
        quota_peak_paged_pool_usage: usize,
        quota_paged_pool_usage: usize,
        quota_peak_non_paged_pool_usage: usize,
        quota_non_paged_pool_usage: usize,
        pagefile_usage: usize,
        peak_pagefile_usage: usize,
        private_page_count: usize,
        read_operation_count: i64,
        write_operation_count: i64,
        other_operation_count: i64,
        read_transfer_count: i64,
        write_transfer_count: i64,
        other_transfer_count: i64,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn OpenProcess(
            desired_access: u32,
            inherit_handle: i32,
            process_id: u32,
        ) -> *mut c_void;
        fn CloseHandle(handle: *mut c_void) -> i32;
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQuerySystemInformation(
            system_information_class: u32,
            system_information: *mut c_void,
            system_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
        fn NtQueryInformationProcess(
            process_handle: *mut c_void,
            process_information_class: u32,
            process_information: *mut c_void,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    struct HandleGuard(*mut c_void);

    impl Drop for HandleGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    #[derive(Debug, Clone, Copy)]
    pub struct WinProcessRow {
        pub pid: u32,
        pub ppid: u32,
        image_name: UnicodeString,
        pub start_time_secs: u64,
        pub cpu_time_100ns: u64,
        pub private_working_set_bytes: u64,
        pub working_set_bytes: u64,
        pub virtual_bytes: u64,
        pub io_read_bytes: u64,
        pub io_write_bytes: u64,
    }

    impl WinProcessRow {
        pub fn decode_name(&self, buffer: &[u8]) -> String {
            decode_unicode_string_in_buffer(self.image_name, buffer).unwrap_or_else(|| {
                if self.pid == 0 {
                    "System Idle Process".to_owned()
                } else {
                    String::new()
                }
            })
        }
    }

    fn filetime_to_unix_secs(filetime: i64) -> u64 {
        if filetime > WINDOWS_EPOCH_OFFSET_100NS {
            ((filetime - WINDOWS_EPOCH_OFFSET_100NS) / 10_000_000) as u64
        } else {
            0
        }
    }

    fn decode_unicode_string_in_buffer(us: UnicodeString, buf: &[u8]) -> Option<String> {
        if us.buffer.is_null() || us.length == 0 {
            return None;
        }
        let byte_len = usize::from(us.length);
        if !byte_len.is_multiple_of(2) {
            return None;
        }
        let base = buf.as_ptr() as usize;
        let end = base.checked_add(buf.len())?;
        let ptr = us.buffer as usize;
        let slice_end = ptr.checked_add(byte_len)?;
        if ptr < base || slice_end > end {
            return None;
        }
        let byte_offset = ptr - base;
        let bytes = &buf[byte_offset..byte_offset + byte_len];
        let units = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        Some(String::from_utf16_lossy(&units))
    }

    /// Snapshots all running Windows processes in a single `NtQuerySystemInformation` syscall
    /// (~1-5ms for 350+ processes, zero per-process String allocations during Stage 1 discovery).
    pub fn snapshot_processes(buffer: &mut Vec<u8>) -> Option<Vec<WinProcessRow>> {
        if buffer.len() < INITIAL_BUFFER_BYTES {
            buffer.resize(INITIAL_BUFFER_BYTES, 0);
        }

        let mut return_length: u32 = 0;
        for _ in 0..8 {
            let status = unsafe {
                NtQuerySystemInformation(
                    SYSTEM_PROCESS_INFORMATION_CLASS,
                    buffer.as_mut_ptr().cast::<c_void>(),
                    buffer.len() as u32,
                    &mut return_length,
                )
            };
            if status >= 0 {
                break;
            }
            if status == STATUS_INFO_LENGTH_MISMATCH {
                let desired = (return_length as usize)
                    .max(buffer.len().saturating_mul(2))
                    .saturating_add(65_536);
                if desired > MAX_BUFFER_BYTES {
                    return None;
                }
                buffer.resize(desired, 0);
                continue;
            }
            return None;
        }

        let mut rows = Vec::with_capacity(512);
        let mut offset = 0usize;
        let struct_size = size_of::<SystemProcessInformation>();
        while offset.saturating_add(struct_size) <= buffer.len() {
            let entry = unsafe {
                buffer
                    .as_ptr()
                    .add(offset)
                    .cast::<SystemProcessInformation>()
                    .read_unaligned()
            };
            let pid = entry.unique_process_id as usize as u32;
            let ppid = entry.inherited_from_unique_process_id as usize as u32;
            let cpu_time_100ns = (entry.kernel_time.max(0) as u64)
                .saturating_add(entry.user_time.max(0) as u64);
            rows.push(WinProcessRow {
                pid,
                ppid,
                image_name: entry.image_name,
                start_time_secs: filetime_to_unix_secs(entry.create_time),
                cpu_time_100ns,
                private_working_set_bytes: entry.working_set_private_size.max(0) as u64,
                working_set_bytes: entry.working_set_size as u64,
                virtual_bytes: entry.pagefile_usage as u64,
                io_read_bytes: entry.read_transfer_count.max(0) as u64,
                io_write_bytes: entry.write_transfer_count.max(0) as u64,
            });
            if entry.next_entry_offset == 0 {
                break;
            }
            offset = match offset.checked_add(entry.next_entry_offset as usize) {
                Some(next) => next,
                None => break,
            };
        }

        Some(rows)
    }

    /// Reads a single tracked process's command line via `ProcessCommandLineInformation` (Win 8.1+,
    /// requires only `PROCESS_QUERY_LIMITED_INFORMATION` — zero `ReadProcessMemory` PEB walks).
    pub fn query_process_command_line(pid: u32) -> Option<String> {
        if pid == 0 {
            return None;
        }
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
        if handle.is_null() {
            return None;
        }
        let _guard = HandleGuard(handle);

        let mut buf = vec![0u8; 4096];
        let mut return_length: u32 = 0;
        for _ in 0..3 {
            let status = unsafe {
                NtQueryInformationProcess(
                    handle,
                    PROCESS_COMMAND_LINE_INFORMATION,
                    buf.as_mut_ptr().cast::<c_void>(),
                    buf.len() as u32,
                    &mut return_length,
                )
            };
            if status >= 0 {
                if buf.len() < size_of::<UnicodeString>() {
                    return None;
                }
                let us = unsafe { buf.as_ptr().cast::<UnicodeString>().read_unaligned() };
                return decode_unicode_string_in_buffer(us, &buf).map(|text| text.trim().to_owned());
            }
            if matches!(
                status,
                STATUS_INFO_LENGTH_MISMATCH | STATUS_BUFFER_OVERFLOW | STATUS_BUFFER_TOO_SMALL
            ) {
                let desired = (return_length as usize)
                    .max(buf.len().saturating_mul(2))
                    .saturating_add(256);
                if desired > MAX_CMD_BUFFER_BYTES {
                    return None;
                }
                buf.resize(desired, 0);
                continue;
            }
            return None;
        }
        None
    }
}

#[cfg(target_os = "windows")]
mod win_power {
    use super::PowerStatus;
    use std::mem::zeroed;

    #[repr(C)]
    struct SystemPowerStatus {
        ac_line_status: u8,
        battery_flag: u8,
        battery_life_percent: u8,
        system_status_flag: u8,
        battery_life_time: u32,
        battery_full_life_time: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetSystemPowerStatus(lp_system_power_status: *mut SystemPowerStatus) -> i32;
    }

    /// Queries Windows AC/battery status and Energy Saver (`SystemStatusFlag` bit 0)
    /// directly via Win32 FFI with zero child processes (< 0.05ms).
    pub fn query_power_status() -> Option<PowerStatus> {
        let mut status: SystemPowerStatus = unsafe { zeroed() };
        let ok = unsafe { GetSystemPowerStatus(&mut status) };
        if ok == 0 {
            return None;
        }
        Some(super::decode_windows_power_status(
            status.ac_line_status,
            status.battery_flag,
            status.battery_life_percent,
            status.system_status_flag,
        ))
    }
}

#[cfg(any(target_os = "windows", test))]
fn decode_windows_power_status(
    ac_line_status: u8,
    battery_flag: u8,
    battery_life_percent: u8,
    system_status_flag: u8,
) -> PowerStatus {
    let on_battery = match ac_line_status {
        0 => Some(true),
        1 => Some(false),
        _ => None,
    };
    let no_battery = battery_flag != 255 && (battery_flag & 128) != 0;
    let battery_percent = if no_battery || battery_life_percent > 100 {
        None
    } else {
        Some(battery_life_percent)
    };
    let is_charging = if battery_flag == 255 || no_battery {
        None
    } else {
        Some((battery_flag & 8) != 0)
    };
    // Win32 SYSTEM_POWER_STATUS.SystemStatusFlag bit 0 indicates Battery Saver / Energy Saver.
    let low_power_mode = Some((system_status_flag & 1) != 0);
    PowerStatus {
        on_battery,
        low_power_mode,
        battery_percent,
        is_charging,
    }
}

#[cfg(target_os = "windows")]
fn query_power_status() -> Option<PowerStatus> {
    win_power::query_power_status()
}

#[cfg(not(target_os = "windows"))]
fn query_power_status() -> Option<PowerStatus> {
    None
}

/// Normalizes sysinfo's per-core CPU% (where 1 full logical core = 100%) to Windows Task
/// Manager's total-system CPU% scale `[0.0, 100.0]`.
fn normalize_cpu_percent(raw_per_core_percent: f32, logical_cpus: usize) -> f32 {
    if !raw_per_core_percent.is_finite() || raw_per_core_percent <= 0.0 {
        return 0.0;
    }
    let cores = logical_cpus.max(1) as f32;
    (raw_per_core_percent / cores).clamp(0.0, 100.0)
}

#[cfg(target_os = "windows")]
fn process_resident_bytes(pid: u32, fallback_working_set_bytes: u64) -> u64 {
    win_mem::private_working_set_bytes(pid).unwrap_or(fallback_working_set_bytes)
}

#[cfg(not(target_os = "windows"))]
fn process_resident_bytes(_pid: u32, fallback_working_set_bytes: u64) -> u64 {
    fallback_working_set_bytes
}

const PROTOCOL_VERSION: u32 = 3;
const MIN_SAMPLE_INTERVAL_MS: u64 = 250;
const MAX_SAMPLE_INTERVAL_MS: u64 = 60_000;
const PROCESS_START_TIME_PRECISION_MS: u64 = 1_000;
const HISTORY_RETENTION_MS: u64 = 60 * 60_000;
const MAX_HISTORY_SNAPSHOTS: usize = 3_600;
const INPUT_QUEUE_CAPACITY: usize = 64;
const MAX_HISTORY_RETAINED_ENTRIES: usize = 20_000;
const MAX_HISTORY_RETAINED_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROCESS_NAME_BYTES: usize = 1_024;
const MAX_PROCESS_COMMAND_BYTES: usize = 16 * 1_024;
const MAX_PROCESS_STATUS_BYTES: usize = 256;
const HISTORY_CHUNK_SNAPSHOTS: usize = 32;
const TEMPERATURE_REFRESH_INTERVAL: Duration = Duration::from_secs(10);
const TWO_STAGE_PROCESS_REFRESH: bool =
    cfg!(any(target_os = "linux", target_os = "macos", target_os = "windows"));

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalProcess {
    pid: u32,
    #[serde(default)]
    start_time_ms: Option<u64>,
}

impl ExternalProcess {
    fn estimated_history_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
    }
}

#[derive(Debug, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum Command {
    Configure {
        version: u32,
        root_pid: u32,
        sample_interval_ms: u64,
        #[serde(default)]
        external_processes: Vec<ExternalProcess>,
    },
    SetExternalProcesses {
        version: u32,
        processes: Vec<ExternalProcess>,
    },
    SetSampleInterval {
        version: u32,
        sample_interval_ms: u64,
    },
    SetStreaming {
        version: u32,
        enabled: bool,
    },
    SampleNow {
        version: u32,
        request_id: String,
    },
    ProcessTable {
        version: u32,
        request_id: String,
    },
    ReadHistory {
        version: u32,
        request_id: String,
        window_ms: u64,
    },
    Shutdown {
        version: u32,
    },
}

impl Command {
    fn version(&self) -> u32 {
        match self {
            Self::Configure { version, .. }
            | Self::SetExternalProcesses { version, .. }
            | Self::SetSampleInterval { version, .. }
            | Self::SetStreaming { version, .. }
            | Self::SampleNow { version, .. }
            | Self::ProcessTable { version, .. }
            | Self::ReadHistory { version, .. }
            | Self::Shutdown { version } => *version,
        }
    }
}

enum Input {
    Command(Command),
    Invalid(String),
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Capabilities {
    cumulative_cpu_time: bool,
    current_cpu_percent: bool,
    resident_memory: bool,
    virtual_memory: bool,
    io_bytes: bool,
    process_start_time: bool,
    process_tree: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HelloEvent {
    version: u32,
    #[serde(rename = "type")]
    event_type: &'static str,
    sidecar_version: &'static str,
    sidecar_pid: u32,
    platform: &'static str,
    arch: &'static str,
    capabilities: Capabilities,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "kebab-case")]
enum IoSemantics {
    Storage,
    AllIo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessSample {
    pid: u32,
    ppid: u32,
    start_time_ms: u64,
    run_time_ms: u64,
    name: String,
    command: String,
    status: String,
    cpu_percent: f32,
    cpu_time_ms: u64,
    resident_bytes: u64,
    virtual_bytes: u64,
    io_read_bytes: u64,
    io_write_bytes: u64,
    io_semantics: IoSemantics,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessTableEntry {
    pid: u32,
    ppid: u32,
    name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessTableEvent<'a> {
    version: u32,
    #[serde(rename = "type")]
    event_type: &'static str,
    request_id: &'a str,
    processes: Vec<ProcessTableEntry>,
}

impl ProcessSample {
    fn estimated_history_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            .saturating_add(self.name.len())
            .saturating_add(self.command.len())
            .saturating_add(self.status.len())
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PowerStatus {
    on_battery: Option<bool>,
    low_power_mode: Option<bool>,
    battery_percent: Option<u8>,
    is_charging: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct HostInfo {
    os_name: String,
    os_version: String,
    arch: String,
    cpu_brand: String,
    physical_cores: usize,
    logical_cores: usize,
    total_memory_bytes: u64,
    used_memory_bytes: u64,
    uptime_seconds: u64,
    temperature_celsius: Option<f32>,
}

impl HostInfo {
    fn estimated_heap_bytes(&self) -> usize {
        self.os_name
            .len()
            .saturating_add(self.os_version.len())
            .saturating_add(self.arch.len())
            .saturating_add(self.cpu_brand.len())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotEvent {
    version: u32,
    #[serde(rename = "type")]
    event_type: &'static str,
    sequence: u64,
    sampled_at_unix_ms: u64,
    collection_duration_micros: u64,
    scanned_process_count: usize,
    retained_process_count: usize,
    inaccessible_process_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    request_id: Option<String>,
    external_processes: Vec<ExternalProcess>,
    processes: Vec<ProcessSample>,
    #[serde(skip_serializing_if = "Option::is_none")]
    host: Option<HostInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    power_status: Option<PowerStatus>,
}

impl SnapshotEvent {
    fn retained_entry_count(&self) -> usize {
        self.processes
            .len()
            .saturating_add(self.external_processes.len())
    }

    fn estimated_history_bytes(&self) -> usize {
        std::mem::size_of::<Self>()
            .saturating_add(
                self.processes
                    .iter()
                    .map(ProcessSample::estimated_history_bytes)
                    .sum::<usize>(),
            )
            .saturating_add(
                self.external_processes
                    .iter()
                    .map(ExternalProcess::estimated_history_bytes)
                    .sum::<usize>(),
            )
            .saturating_add(self.host.as_ref().map_or(0, HostInfo::estimated_heap_bytes))
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryChunkEvent<'a> {
    version: u32,
    #[serde(rename = "type")]
    event_type: &'static str,
    request_id: &'a str,
    done: bool,
    snapshots: &'a [SnapshotEvent],
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorEvent {
    version: u32,
    #[serde(rename = "type")]
    event_type: &'static str,
    code: &'static str,
    message: String,
    recoverable: bool,
}

#[derive(Debug, Clone)]
struct CollectorConfig {
    root_pid: u32,
    sample_interval: Option<Duration>,
    external_processes: HashMap<u32, Option<u64>>,
}

#[derive(Default)]
struct HistoryRecorder {
    snapshots: VecDeque<SnapshotEvent>,
    retained_entry_count: usize,
    retained_bytes: usize,
}

impl HistoryRecorder {
    fn record(&mut self, snapshot: &SnapshotEvent) {
        self.record_with_limits(
            snapshot,
            MAX_HISTORY_SNAPSHOTS,
            MAX_HISTORY_RETAINED_ENTRIES,
            MAX_HISTORY_RETAINED_BYTES,
        );
    }

    fn record_with_limits(
        &mut self,
        snapshot: &SnapshotEvent,
        max_snapshots: usize,
        max_retained_entries: usize,
        max_retained_bytes: usize,
    ) {
        let clock_moved_backward = self
            .snapshots
            .back()
            .is_some_and(|previous| previous.sampled_at_unix_ms > snapshot.sampled_at_unix_ms);
        let mut retained = snapshot.clone();
        retained.request_id = None;
        retained.host = None;
        retained.power_status = None;
        self.retained_entry_count = self
            .retained_entry_count
            .saturating_add(retained.retained_entry_count());
        self.retained_bytes = self
            .retained_bytes
            .saturating_add(retained.estimated_history_bytes());
        self.snapshots.push_back(retained);
        self.trim_to_limits(
            snapshot.sampled_at_unix_ms,
            max_snapshots,
            max_retained_entries,
            max_retained_bytes,
            clock_moved_backward,
        );
    }

    fn trim_to_limits(
        &mut self,
        now_ms: u64,
        max_snapshots: usize,
        max_retained_entries: usize,
        max_retained_bytes: usize,
        clock_moved_backward: bool,
    ) {
        if clock_moved_backward {
            let mut future_entry_count = 0usize;
            let mut future_bytes = 0usize;
            self.snapshots.retain(|snapshot| {
                let keep = snapshot.sampled_at_unix_ms <= now_ms;
                if !keep {
                    future_entry_count =
                        future_entry_count.saturating_add(snapshot.retained_entry_count());
                    future_bytes = future_bytes.saturating_add(snapshot.estimated_history_bytes());
                }
                keep
            });
            self.retained_entry_count =
                self.retained_entry_count.saturating_sub(future_entry_count);
            self.retained_bytes = self.retained_bytes.saturating_sub(future_bytes);
        }

        while self.snapshots.front().is_some_and(|snapshot| {
            snapshot.sampled_at_unix_ms < now_ms.saturating_sub(HISTORY_RETENTION_MS)
                || self.snapshots.len() > max_snapshots
                || self.retained_entry_count > max_retained_entries
                || self.retained_bytes > max_retained_bytes
        }) {
            if let Some(removed) = self.snapshots.pop_front() {
                self.retained_entry_count = self
                    .retained_entry_count
                    .saturating_sub(removed.retained_entry_count());
                self.retained_bytes = self
                    .retained_bytes
                    .saturating_sub(removed.estimated_history_bytes());
            }
        }
    }

    fn read(&self, window_ms: u64, now_ms: u64) -> Vec<SnapshotEvent> {
        let started_at_ms = now_ms.saturating_sub(window_ms.min(HISTORY_RETENTION_MS));
        self.snapshots
            .iter()
            .filter(|snapshot| {
                snapshot.sampled_at_unix_ms >= started_at_ms
                    && snapshot.sampled_at_unix_ms <= now_ms
            })
            .cloned()
            .collect()
    }
}

struct StaticHostInfo {
    os_name: String,
    os_version: String,
    arch: String,
    cpu_brand: String,
    physical_cores: usize,
    logical_cores: usize,
}

fn select_cpu_temperature_celsius<'a>(
    readings: impl IntoIterator<Item = (&'a str, Option<f32>)>,
) -> Option<f32> {
    let mut preferred: Option<f32> = None;
    let mut fallback: Option<f32> = None;

    for (label, temp) in readings {
        let Some(value) = temp else {
            continue;
        };
        if !value.is_finite() || value <= 0.0 || value > 130.0 {
            continue;
        }
        let lower = label.to_ascii_lowercase();
        let is_cpu_sensor = lower.contains("cpu")
            || lower.contains("package")
            || lower.contains("tctl")
            || lower.contains("tdie")
            || lower.contains("core")
            || lower.contains("soc");
        if is_cpu_sensor {
            preferred = Some(preferred.map_or(value, |current| current.max(value)));
        } else {
            fallback = Some(fallback.map_or(value, |current| current.max(value)));
        }
    }

    preferred
        .or(fallback)
        .map(|value| (value * 10.0).round() / 10.0)
}

fn extract_components_temperature(components: &Components) -> Option<f32> {
    select_cpu_temperature_celsius(
        components
            .list()
            .iter()
            .map(|component| (component.label(), component.temperature())),
    )
}

struct Collector {
    system: System,
    details_system: System,
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    process_table_system: System,
    #[cfg(target_os = "windows")]
    win_proc_buf: Vec<u8>,
    #[cfg(target_os = "windows")]
    win_cpu_baseline: HashMap<(u32, u64), (u64, Instant)>,
    cmd_cache: HashMap<(u32, u64), String>,
    static_host: StaticHostInfo,
    components: Components,
    last_temp_refresh: Option<Instant>,
    cached_temperature_celsius: Option<f32>,
    sequence: u64,
    cpu_baseline_refreshed_at: Option<Instant>,
}

impl Collector {
    fn new() -> Self {
        let mut system = System::new();
        system.refresh_cpu_list(CpuRefreshKind::nothing());
        system.refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        let logical_cores = {
            let from_sysinfo = system.cpus().len();
            if from_sysinfo > 0 {
                from_sysinfo
            } else {
                std::thread::available_parallelism()
                    .map(usize::from)
                    .unwrap_or(1)
                    .max(1)
            }
        };
        let physical_cores = System::physical_core_count().unwrap_or(logical_cores);
        let cpu_brand = system
            .cpus()
            .first()
            .map(|cpu| cpu.brand().trim().to_owned())
            .unwrap_or_default();
        let static_host = StaticHostInfo {
            os_name: System::name().unwrap_or_else(|| std::env::consts::OS.to_owned()),
            os_version: System::os_version().unwrap_or_default(),
            arch: std::env::consts::ARCH.to_owned(),
            cpu_brand,
            physical_cores,
            logical_cores,
        };
        // Probe thermal sensors once at startup so platforms without exposed sensors
        // (e.g. Windows without WMI thermal zones) pay zero per-tick overhead.
        let components = Components::new_with_refreshed_list();
        let cached_temperature_celsius = extract_components_temperature(&components);
        let last_temp_refresh = (!components.list().is_empty()).then(Instant::now);
        Self {
            system,
            details_system: System::new(),
            #[cfg(not(any(target_os = "linux", target_os = "windows")))]
            process_table_system: System::new(),
            #[cfg(target_os = "windows")]
            win_proc_buf: Vec::new(),
            #[cfg(target_os = "windows")]
            win_cpu_baseline: HashMap::new(),
            cmd_cache: HashMap::new(),
            static_host,
            components,
            last_temp_refresh,
            cached_temperature_celsius,
            sequence: 0,
            cpu_baseline_refreshed_at: None,
        }
    }

    fn logical_cpu_count(&self) -> usize {
        self.static_host.logical_cores
    }

    fn collect_host_info(&mut self) -> HostInfo {
        self.system
            .refresh_memory_specifics(MemoryRefreshKind::nothing().with_ram());
        if !self.components.list().is_empty()
            && self
                .last_temp_refresh
                .is_none_or(|last| last.elapsed() >= TEMPERATURE_REFRESH_INTERVAL)
        {
            self.components.refresh(false);
            self.cached_temperature_celsius = extract_components_temperature(&self.components);
            self.last_temp_refresh = Some(Instant::now());
        }
        HostInfo {
            os_name: self.static_host.os_name.clone(),
            os_version: self.static_host.os_version.clone(),
            arch: self.static_host.arch.clone(),
            cpu_brand: self.static_host.cpu_brand.clone(),
            physical_cores: self.static_host.physical_cores,
            logical_cores: self.static_host.logical_cores,
            total_memory_bytes: self.system.total_memory(),
            used_memory_bytes: self.system.used_memory(),
            uptime_seconds: System::uptime(),
            temperature_celsius: self.cached_temperature_celsius,
        }
    }

    fn prime_cpu_usage(&mut self) {
        #[cfg(target_os = "windows")]
        {
            if let Some(rows) = win_proc::snapshot_processes(&mut self.win_proc_buf) {
                let now = Instant::now();
                self.win_cpu_baseline.clear();
                for row in rows {
                    if row.pid > 0 {
                        self.win_cpu_baseline
                            .insert((row.pid, row.start_time_secs), (row.cpu_time_100ns, now));
                    }
                }
                self.cpu_baseline_refreshed_at = Some(now);
                return;
            }
        }
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            process_discovery_refresh_kind(),
        );
        self.cpu_baseline_refreshed_at = Some(Instant::now());
    }

    // Terminal polling asks for this every second while a shell is open. On
    // Linux one read of /proc/<pid>/stat has everything; sysinfo also opens
    // /proc/<pid>/status and builds a full record per process, ~3x the CPU.
    #[cfg(target_os = "linux")]
    fn process_table(&mut self) -> Vec<ProcessTableEntry> {
        use std::io::Read;

        let Ok(entries) = std::fs::read_dir("/proc") else {
            return Vec::new();
        };
        let mut buffer = Vec::with_capacity(512);
        let mut processes = entries
            .filter_map(|entry| {
                let entry = entry.ok()?;
                let pid = entry.file_name().to_str()?.parse::<u32>().ok()?;
                buffer.clear();
                std::fs::File::open(entry.path().join("stat"))
                    .ok()?
                    .read_to_end(&mut buffer)
                    .ok()?;
                let (name, ppid) = parse_proc_stat(&buffer)?;
                Some(ProcessTableEntry { pid, ppid, name })
            })
            .collect::<Vec<_>>();
        processes.sort_by_key(|process| process.pid);
        processes
    }

    #[cfg(target_os = "windows")]
    fn process_table(&mut self) -> Vec<ProcessTableEntry> {
        let Some(rows) = win_proc::snapshot_processes(&mut self.win_proc_buf) else {
            return Vec::new();
        };
        let mut processes = rows
            .into_iter()
            .filter_map(|row| {
                // Kernel idle PID 0 would fail the server's positive-PID event schema.
                if row.pid == 0 {
                    return None;
                }
                Some(ProcessTableEntry {
                    pid: row.pid,
                    ppid: row.ppid,
                    name: truncate_utf8(
                        row.decode_name(&self.win_proc_buf),
                        MAX_PROCESS_NAME_BYTES,
                    ),
                })
            })
            .collect::<Vec<_>>();
        processes.sort_by_key(|process| process.pid);
        processes
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    fn process_table(&mut self) -> Vec<ProcessTableEntry> {
        // Reuse a dedicated System to preserve snapshot CPU baselines without
        // allocating and dropping System::new() every second.
        self.process_table_system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );
        let mut processes = self
            .process_table_system
            .processes()
            .iter()
            .filter_map(|(pid, process)| {
                let pid = pid.as_u32();
                // Kernel idle PID 0 would fail the server's positive-PID event schema.
                if pid == 0 {
                    return None;
                }
                Some(ProcessTableEntry {
                    pid,
                    ppid: process.parent().map(Pid::as_u32).unwrap_or(0),
                    name: truncate_utf8(
                        process.name().to_string_lossy().into_owned(),
                        MAX_PROCESS_NAME_BYTES,
                    ),
                })
            })
            .collect::<Vec<_>>();
        processes.sort_by_key(|process| process.pid);
        processes
    }

    #[cfg(target_os = "windows")]
    fn sample_windows_fast(
        &mut self,
        config: &CollectorConfig,
        request_id: Option<String>,
        collection_started: Instant,
    ) -> Option<SnapshotEvent> {
        let win_rows = win_proc::snapshot_processes(&mut self.win_proc_buf)?;
        let sampled_instant = Instant::now();
        self.cpu_baseline_refreshed_at = Some(sampled_instant);

        let scanned_process_count = win_rows.len();
        let mut by_pid = HashMap::<u32, win_proc::WinProcessRow>::with_capacity(win_rows.len());
        let mut tree_rows = Vec::with_capacity(win_rows.len());
        for row in win_rows {
            if row.pid == 0 {
                continue;
            }
            tree_rows.push((row.pid, row.ppid, row.start_time_secs.saturating_mul(1_000)));
            by_pid.insert(row.pid, row);
        }

        let external_processes = config
            .external_processes
            .iter()
            .filter_map(|(pid, expected_start_time_ms)| {
                let row = by_pid.get(pid)?;
                let actual_start_time_ms = row.start_time_secs.saturating_mul(1_000);
                matches_external_identity(actual_start_time_ms, *expected_start_time_ms).then_some(
                    ExternalProcess {
                        pid: *pid,
                        start_time_ms: Some(actual_start_time_ms),
                    },
                )
            })
            .collect::<Vec<_>>();

        let mut roots = external_processes
            .iter()
            .map(|process| process.pid)
            .collect::<HashSet<_>>();
        roots.insert(config.root_pid);
        let tracked = select_tracked_pids(&tree_rows, &roots);
        let tracked_process_count = tracked.len();

        let tracked_identities = tracked
            .iter()
            .filter_map(|pid| by_pid.get(pid).map(|row| (*pid, row.start_time_secs)))
            .collect::<HashSet<_>>();
        self.cmd_cache
            .retain(|identity, _| tracked_identities.contains(identity));
        self.win_cpu_baseline
            .retain(|identity, _| tracked_identities.contains(identity));

        let logical_cpus = self.logical_cpu_count().max(1) as f64;
        let now_unix_ms = unix_time_ms();
        let now_unix_secs = now_unix_ms / 1_000;
        let mut processes = Vec::with_capacity(tracked.len());

        for pid in tracked {
            let Some(row) = by_pid.get(&pid) else {
                continue;
            };
            let identity = (pid, row.start_time_secs);
            let cpu_percent = if let Some((prev_cpu_100ns, prev_at)) =
                self.win_cpu_baseline.insert(identity, (row.cpu_time_100ns, sampled_instant))
            {
                let delta_cpu_100ns = row.cpu_time_100ns.saturating_sub(prev_cpu_100ns) as f64;
                let delta_wall_100ns = (sampled_instant.duration_since(prev_at).as_nanos() / 100)
                    .max(1) as f64;
                ((delta_cpu_100ns / (delta_wall_100ns * logical_cpus)) * 100.0).clamp(0.0, 100.0)
                    as f32
            } else {
                0.0
            };

            let name = row.decode_name(&self.win_proc_buf);
            let command = if let Some(cached) = self.cmd_cache.get(&identity) {
                cached.clone()
            } else {
                let resolved = win_proc::query_process_command_line(pid)
                    .filter(|cmd| !cmd.is_empty())
                    .unwrap_or_else(|| name.clone());
                let truncated = truncate_utf8(resolved, MAX_PROCESS_COMMAND_BYTES);
                self.cmd_cache.insert(identity, truncated.clone());
                truncated
            };

            let resident_bytes = if row.private_working_set_bytes > 0 {
                row.private_working_set_bytes
            } else {
                process_resident_bytes(pid, row.working_set_bytes)
            };

            processes.push(ProcessSample {
                pid,
                ppid: row.ppid,
                start_time_ms: row.start_time_secs.saturating_mul(1_000),
                run_time_ms: now_unix_secs
                    .saturating_sub(row.start_time_secs)
                    .saturating_mul(1_000),
                name: truncate_utf8(name, MAX_PROCESS_NAME_BYTES),
                command,
                status: "Run".to_owned(),
                cpu_percent,
                cpu_time_ms: row.cpu_time_100ns / 10_000,
                resident_bytes,
                virtual_bytes: row.virtual_bytes,
                io_read_bytes: row.io_read_bytes,
                io_write_bytes: row.io_write_bytes,
                io_semantics: io_semantics(),
            });
        }

        processes.sort_by_key(|process| process.pid);
        let host = Some(self.collect_host_info());
        let power_status = query_power_status();
        self.sequence = self.sequence.saturating_add(1);

        Some(SnapshotEvent {
            version: PROTOCOL_VERSION,
            event_type: "snapshot",
            sequence: self.sequence,
            sampled_at_unix_ms: now_unix_ms,
            collection_duration_micros: collection_started.elapsed().as_micros() as u64,
            scanned_process_count,
            retained_process_count: processes.len(),
            inaccessible_process_count: inaccessible_process_count(
                tracked_process_count,
                processes.len(),
            ),
            request_id,
            external_processes,
            processes,
            host,
            power_status,
        })
    }

    fn sample(&mut self, config: &CollectorConfig, request_id: Option<String>) -> SnapshotEvent {
        if let Some(delay) =
            remaining_cpu_measurement_delay(self.cpu_baseline_refreshed_at.take(), Instant::now())
        {
            thread::sleep(delay);
        }
        let collection_started = Instant::now();
        #[cfg(target_os = "windows")]
        if let Some(snapshot) =
            self.sample_windows_fast(config, request_id.clone(), collection_started)
        {
            return snapshot;
        }
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            process_discovery_refresh_kind(),
        );
        self.cpu_baseline_refreshed_at = Some(Instant::now());

        let rows = self
            .system
            .processes()
            .iter()
            .map(|(pid, process)| {
                let pid = pid.as_u32();
                let ppid = process.parent().map(Pid::as_u32).unwrap_or(0);
                (pid, ppid, process.start_time().saturating_mul(1_000))
            })
            .collect::<Vec<_>>();
        let external_processes = config
            .external_processes
            .iter()
            .filter_map(|(pid, expected_start_time_ms)| {
                let process = self.system.process(Pid::from_u32(*pid))?;
                let actual_start_time_ms = process.start_time().saturating_mul(1_000);
                matches_external_identity(actual_start_time_ms, *expected_start_time_ms).then_some(
                    ExternalProcess {
                        pid: *pid,
                        start_time_ms: Some(actual_start_time_ms),
                    },
                )
            })
            .collect::<Vec<_>>();
        let mut roots = external_processes
            .iter()
            .map(|process| process.pid)
            .collect::<HashSet<_>>();
        roots.insert(config.root_pid);
        let tracked = select_tracked_pids(&rows, &roots);
        let tracked_process_count = tracked.len();
        let tracked_identities = tracked
            .iter()
            .filter_map(|pid| {
                self.system
                    .process(Pid::from_u32(*pid))
                    .map(|process| (*pid, process.start_time()))
            })
            .collect::<HashSet<_>>();
        self.cmd_cache
            .retain(|identity, _| tracked_identities.contains(identity));

        let start_time_offset = if TWO_STAGE_PROCESS_REFRESH && !tracked.is_empty() {
            let monitor_pid = Pid::from_u32(std::process::id());
            let mut detail_pids = tracked
                .iter()
                .copied()
                .map(Pid::from_u32)
                .collect::<Vec<_>>();
            if !tracked.contains(&monitor_pid.as_u32()) {
                detail_pids.push(monitor_pid);
            }
            let detail_pid_set = detail_pids.iter().copied().collect::<HashSet<_>>();
            // Release OS handles immediately if any previously tracked process exited or left the tree.
            let has_stale_detail = self
                .details_system
                .processes()
                .keys()
                .any(|pid| !detail_pid_set.contains(pid));
            if has_stale_detail {
                self.details_system = System::new();
            }
            let needs_cmd_refresh = tracked_identities
                .iter()
                .any(|identity| !self.cmd_cache.contains_key(identity));
            self.details_system.refresh_processes_specifics(
                ProcessesToUpdate::Some(&detail_pids),
                true,
                process_detail_refresh_kind(needs_cmd_refresh),
            );
            // This process cannot be replaced during collection. Its start time
            // exposes any boot-epoch shift between the two System instances.
            self.system.process(monitor_pid).and_then(|process| {
                self.details_system.process(monitor_pid).map(|detail| {
                    i128::from(detail.start_time()) - i128::from(process.start_time())
                })
            })
        } else {
            if !self.details_system.processes().is_empty() {
                self.details_system = System::new();
            }
            Some(0)
        };
        let logical_cpus = self.logical_cpu_count();
        let mut processes = Vec::with_capacity(tracked.len());
        for pid in tracked {
            let Some(process) = self.system.process(Pid::from_u32(pid)) else {
                continue;
            };
            let details = if TWO_STAGE_PROCESS_REFRESH {
                let Some(details) = self.details_system.process(Pid::from_u32(pid)) else {
                    continue;
                };
                details
            } else {
                process
            };
            let Some(offset) = start_time_offset else {
                continue;
            };
            if !matches_process_start_time(process.start_time(), details.start_time(), offset) {
                continue;
            }
            let disk_usage = details.disk_usage();
            let cache_key = (pid, process.start_time());
            let command = if let Some(cached) = self.cmd_cache.get(&cache_key) {
                cached.clone()
            } else {
                let resolved = if details.cmd().is_empty() {
                    process.name().to_string_lossy().into_owned()
                } else {
                    details
                        .cmd()
                        .iter()
                        .map(|part| part.to_string_lossy())
                        .collect::<Vec<_>>()
                        .join(" ")
                };
                let truncated = truncate_utf8(resolved, MAX_PROCESS_COMMAND_BYTES);
                self.cmd_cache.insert(cache_key, truncated.clone());
                truncated
            };

            processes.push(ProcessSample {
                pid,
                ppid: process.parent().map(Pid::as_u32).unwrap_or(0),
                start_time_ms: process.start_time().saturating_mul(1_000),
                run_time_ms: process.run_time().saturating_mul(1_000),
                name: truncate_utf8(
                    process.name().to_string_lossy().into_owned(),
                    MAX_PROCESS_NAME_BYTES,
                ),
                command,
                status: truncate_utf8(
                    format!("{:?}", process.status()),
                    MAX_PROCESS_STATUS_BYTES,
                ),
                cpu_percent: normalize_cpu_percent(process.cpu_usage(), logical_cpus),
                cpu_time_ms: process.accumulated_cpu_time(),
                resident_bytes: process_resident_bytes(pid, details.memory()),
                virtual_bytes: details.virtual_memory(),
                io_read_bytes: disk_usage.total_read_bytes,
                io_write_bytes: disk_usage.total_written_bytes,
                io_semantics: io_semantics(),
            });
        }
        processes.sort_by_key(|process| process.pid);
        let host = Some(self.collect_host_info());
        let power_status = query_power_status();
        self.sequence = self.sequence.saturating_add(1);

        SnapshotEvent {
            version: PROTOCOL_VERSION,
            event_type: "snapshot",
            sequence: self.sequence,
            sampled_at_unix_ms: unix_time_ms(),
            collection_duration_micros: collection_started.elapsed().as_micros() as u64,
            scanned_process_count: self.system.processes().len(),
            retained_process_count: processes.len(),
            inaccessible_process_count: inaccessible_process_count(
                tracked_process_count,
                processes.len(),
            ),
            request_id,
            external_processes,
            processes,
            host,
            power_status,
        }
    }
}

// Keep CPU baselines separate. Even a metadata refresh resets Linux process times.
fn process_discovery_refresh_kind() -> ProcessRefreshKind {
    if TWO_STAGE_PROCESS_REFRESH {
        ProcessRefreshKind::nothing().with_cpu().without_tasks()
    } else {
        process_refresh_kind()
    }
}

fn process_detail_refresh_kind(include_cmd: bool) -> ProcessRefreshKind {
    let kind = ProcessRefreshKind::nothing()
        .with_memory()
        .with_disk_usage()
        .without_tasks();
    if include_cmd {
        kind.with_cmd(UpdateKind::OnlyIfNotSet)
    } else {
        kind
    }
}

fn process_refresh_kind() -> ProcessRefreshKind {
    ProcessRefreshKind::nothing()
        .with_memory()
        .with_cpu()
        .with_disk_usage()
        .with_cmd(UpdateKind::OnlyIfNotSet)
        .without_tasks()
}

/// Name and parent pid from `/proc/<pid>/stat`: `pid (comm) state ppid ...`.
/// The name may itself contain spaces and parentheses, so it ends at the last `)`.
#[cfg(any(target_os = "linux", test))]
fn parse_proc_stat(stat: &[u8]) -> Option<(String, u32)> {
    let open = stat.iter().position(|&byte| byte == b'(')?;
    let close = stat.iter().rposition(|&byte| byte == b')')?;
    let name = stat.get(open + 1..close)?;
    let mut fields = stat.get(close + 1..)?.split(|&byte| byte == b' ');
    fields.next()?;
    fields.next()?;
    let ppid = std::str::from_utf8(fields.next()?).ok()?.parse().ok()?;
    let name = truncate_utf8(
        String::from_utf8_lossy(name).into_owned(),
        MAX_PROCESS_NAME_BYTES,
    );
    Some((name, ppid))
}

fn inaccessible_process_count(selected: usize, materialized: usize) -> usize {
    selected.saturating_sub(materialized)
}

fn matches_process_start_time(discovered: u64, detail: u64, epoch_offset: i128) -> bool {
    i128::from(detail) - epoch_offset == i128::from(discovered)
}

fn remaining_cpu_measurement_delay(
    baseline_refreshed_at: Option<Instant>,
    now: Instant,
) -> Option<Duration> {
    baseline_refreshed_at
        .and_then(|baseline| MINIMUM_CPU_UPDATE_INTERVAL.checked_sub(now.duration_since(baseline)))
        .filter(|delay| !delay.is_zero())
}

fn matches_external_identity(
    actual_start_time_ms: u64,
    expected_start_time_ms: Option<u64>,
) -> bool {
    // Match sysinfo's whole-second precision without admitting reused PIDs from adjacent seconds.
    expected_start_time_ms.is_none_or(|expected| {
        actual_start_time_ms == expected - (expected % PROCESS_START_TIME_PRECISION_MS)
    })
}

fn select_tracked_pids(rows: &[(u32, u32, u64)], roots: &HashSet<u32>) -> HashSet<u32> {
    let mut children_by_parent = HashMap::<u32, Vec<(u32, u64)>>::new();
    let mut start_time_by_pid = HashMap::<u32, u64>::new();
    for (pid, ppid, start_time_ms) in rows {
        children_by_parent
            .entry(*ppid)
            .or_default()
            .push((*pid, *start_time_ms));
        start_time_by_pid.insert(*pid, *start_time_ms);
    }

    let mut tracked = HashSet::new();
    let mut visited_identities = HashSet::new();
    let mut queue = roots
        .iter()
        .filter_map(|pid| {
            start_time_by_pid
                .get(pid)
                .map(|start_time_ms| (*pid, *start_time_ms))
        })
        .collect::<VecDeque<_>>();

    while let Some((pid, start_time_ms)) = queue.pop_front() {
        if !visited_identities.insert((pid, start_time_ms)) {
            continue;
        }
        tracked.insert(pid);
        if let Some(children) = children_by_parent.get(&pid) {
            queue.extend(
                children
                    .iter()
                    .copied()
                    .filter(|(_, child_start_time_ms)| *child_start_time_ms >= start_time_ms),
            );
        }
    }

    tracked
}

fn truncate_utf8(mut value: String, max_bytes: usize) -> String {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while !value.is_char_boundary(boundary) {
        boundary = boundary.saturating_sub(1);
    }
    value.truncate(boundary);
    value
}

fn io_semantics() -> IoSemantics {
    if cfg!(target_os = "windows") {
        IoSemantics::AllIo
    } else {
        IoSemantics::Storage
    }
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn clamp_sample_interval(sample_interval_ms: u64) -> Option<Duration> {
    (sample_interval_ms > 0).then(|| {
        Duration::from_millis(
            sample_interval_ms.clamp(MIN_SAMPLE_INTERVAL_MS, MAX_SAMPLE_INTERVAL_MS),
        )
    })
}

fn spawn_input_reader() -> Receiver<Input> {
    let (sender, receiver) = mpsc::sync_channel(INPUT_QUEUE_CAPACITY);
    thread::spawn(move || {
        let stdin = io::stdin();
        for line in stdin.lock().lines() {
            let line = match line {
                Ok(line) => line,
                Err(error) => {
                    let _ = sender.send(Input::Invalid(format!(
                        "failed reading command stream: {error}"
                    )));
                    return;
                }
            };
            if line.trim().is_empty() {
                continue;
            }
            match serde_json::from_str::<Command>(&line) {
                Ok(command) => {
                    if sender.send(Input::Command(command)).is_err() {
                        return;
                    }
                }
                Err(error) => {
                    if sender
                        .send(Input::Invalid(format!("invalid command: {error}")))
                        .is_err()
                    {
                        return;
                    }
                }
            }
        }
    });
    receiver
}

fn sample_now_deadline(
    current: Option<Instant>,
    interval: Option<Duration>,
    now: Instant,
) -> Option<Instant> {
    current.or_else(|| interval.map(|duration| now + duration))
}

fn write_event<T: Serialize>(writer: &mut impl Write, event: &T) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, event)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn write_error(
    writer: &mut impl Write,
    code: &'static str,
    message: impl Into<String>,
    recoverable: bool,
) -> io::Result<()> {
    write_event(
        writer,
        &ErrorEvent {
            version: PROTOCOL_VERSION,
            event_type: "error",
            code,
            message: message.into(),
            recoverable,
        },
    )
}

fn write_history(
    writer: &mut impl Write,
    request_id: &str,
    snapshots: &[SnapshotEvent],
) -> io::Result<()> {
    if snapshots.is_empty() {
        return write_event(
            writer,
            &HistoryChunkEvent {
                version: PROTOCOL_VERSION,
                event_type: "historyChunk",
                request_id,
                done: true,
                snapshots,
            },
        );
    }

    let chunk_count = snapshots.len().div_ceil(HISTORY_CHUNK_SNAPSHOTS);
    for (index, chunk) in snapshots.chunks(HISTORY_CHUNK_SNAPSHOTS).enumerate() {
        write_event(
            writer,
            &HistoryChunkEvent {
                version: PROTOCOL_VERSION,
                event_type: "historyChunk",
                request_id,
                done: index + 1 == chunk_count,
                snapshots: chunk,
            },
        )?;
    }
    Ok(())
}

fn main() -> io::Result<()> {
    let mut writer = BufWriter::new(io::stdout().lock());
    write_event(
        &mut writer,
        &HelloEvent {
            version: PROTOCOL_VERSION,
            event_type: "hello",
            sidecar_version: env!("CARGO_PKG_VERSION"),
            sidecar_pid: std::process::id(),
            platform: std::env::consts::OS,
            arch: std::env::consts::ARCH,
            capabilities: Capabilities {
                cumulative_cpu_time: true,
                current_cpu_percent: true,
                resident_memory: true,
                virtual_memory: true,
                io_bytes: true,
                process_start_time: true,
                process_tree: true,
            },
        },
    )?;

    let receiver = spawn_input_reader();
    let mut collector = Collector::new();
    let mut history = HistoryRecorder::default();
    let mut config: Option<CollectorConfig> = None;
    let mut next_sample_at: Option<Instant> = None;
    let mut streaming_enabled = false;

    loop {
        if next_sample_at.is_some_and(|deadline| deadline <= Instant::now()) {
            if let Some(current) = config.as_ref() {
                if let Some(interval) = current.sample_interval {
                    let event = collector.sample(current, None);
                    history.record(&event);
                    if streaming_enabled {
                        write_event(&mut writer, &event)?;
                    }
                    next_sample_at = Some(Instant::now() + interval);
                } else {
                    next_sample_at = None;
                }
            } else {
                next_sample_at = None;
            }
            continue;
        }

        let timeout = next_sample_at
            .map(|deadline| deadline.saturating_duration_since(Instant::now()))
            .unwrap_or(Duration::from_secs(60));

        match receiver.recv_timeout(timeout) {
            Ok(Input::Invalid(message)) => {
                write_error(&mut writer, "invalid-command", message, true)?;
            }
            Ok(Input::Command(command)) => {
                if command.version() != PROTOCOL_VERSION {
                    write_error(
                        &mut writer,
                        "protocol-mismatch",
                        format!(
                            "unsupported protocol version {}; expected {PROTOCOL_VERSION}",
                            command.version()
                        ),
                        false,
                    )?;
                    continue;
                }

                match command {
                    Command::Configure {
                        root_pid,
                        sample_interval_ms,
                        external_processes,
                        ..
                    } => {
                        let sample_interval = clamp_sample_interval(sample_interval_ms);
                        config = Some(CollectorConfig {
                            root_pid,
                            sample_interval,
                            external_processes: external_processes
                                .into_iter()
                                .map(|process| (process.pid, process.start_time_ms))
                                .collect(),
                        });
                        collector.prime_cpu_usage();
                        next_sample_at = sample_interval.map(|_| Instant::now());
                    }
                    Command::SetExternalProcesses { processes, .. } => {
                        if let Some(current) = config.as_mut() {
                            current.external_processes = processes
                                .into_iter()
                                .map(|process| (process.pid, process.start_time_ms))
                                .collect();
                        } else {
                            write_error(
                                &mut writer,
                                "not-configured",
                                "configure must be sent before external processes",
                                true,
                            )?;
                        }
                    }
                    Command::SetSampleInterval {
                        sample_interval_ms, ..
                    } => {
                        if let Some(current) = config.as_mut() {
                            current.sample_interval = clamp_sample_interval(sample_interval_ms);
                            next_sample_at = current
                                .sample_interval
                                .map(|interval| Instant::now() + interval);
                        } else {
                            write_error(
                                &mut writer,
                                "not-configured",
                                "configure must be sent before changing the sample interval",
                                true,
                            )?;
                        }
                    }
                    Command::SetStreaming { enabled, .. } => {
                        streaming_enabled = enabled;
                    }
                    Command::SampleNow { request_id, .. } => {
                        if let Some(current) = config.as_ref() {
                            let event = collector.sample(current, Some(request_id));
                            history.record(&event);
                            write_event(&mut writer, &event)?;
                            next_sample_at = sample_now_deadline(
                                next_sample_at,
                                current.sample_interval,
                                Instant::now(),
                            );
                        } else {
                            write_error(
                                &mut writer,
                                "not-configured",
                                "configure must be sent before sampling",
                                true,
                            )?;
                        }
                    }
                    Command::ProcessTable { request_id, .. } => {
                        let event = ProcessTableEvent {
                            version: PROTOCOL_VERSION,
                            event_type: "processTable",
                            request_id: &request_id,
                            processes: collector.process_table(),
                        };
                        write_event(&mut writer, &event)?;
                    }
                    Command::ReadHistory {
                        request_id,
                        window_ms,
                        ..
                    } => {
                        if config.is_some() {
                            let snapshots = history.read(window_ms, unix_time_ms());
                            write_history(&mut writer, &request_id, &snapshots)?;
                        } else {
                            write_error(
                                &mut writer,
                                "not-configured",
                                "configure must be sent before reading history",
                                true,
                            )?;
                        }
                    }
                    Command::Shutdown { .. } => return Ok(()),
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selects_roots_and_all_descendants() {
        let rows = vec![
            (10, 1, 1_000),
            (11, 10, 1_100),
            (12, 11, 1_200),
            (20, 1, 2_000),
            (21, 20, 2_100),
            (30, 99, 3_000),
        ];
        let tracked = select_tracked_pids(&rows, &HashSet::from([10, 20]));

        assert_eq!(tracked, HashSet::from([10, 11, 12, 20, 21]));
    }

    #[test]
    fn rejects_descendants_older_than_a_reused_parent_pid() {
        let rows = vec![
            (20, 1, 5_000),
            (21, 20, 4_000),
            (22, 20, 5_100),
            (23, 21, 5_200),
        ];
        let tracked = select_tracked_pids(&rows, &HashSet::from([20]));

        assert_eq!(tracked, HashSet::from([20, 22]));
    }

    #[test]
    fn ignores_missing_roots() {
        let rows = vec![(10, 1, 1_000), (11, 10, 1_100)];
        let tracked = select_tracked_pids(&rows, &HashSet::from([99]));

        assert!(tracked.is_empty());
    }

    #[test]
    fn validates_external_process_start_identity() {
        for (actual, expected, matches) in [
            (10_000, None, true),
            (10_000, Some(10_000), true),
            (10_000, Some(10_999), true),
            (10_000, Some(11_000), false),
            (10_000, Some(9_999), false),
            (0, Some(999), true),
            (0, Some(1_000), false),
            (u64::MAX, None, true),
            (u64::MAX, Some(u64::MAX), false),
        ] {
            assert_eq!(matches_external_identity(actual, expected), matches);
        }
    }

    #[test]
    fn loads_details_when_an_existing_process_becomes_selected() {
        let mut collector = Collector::new();
        let mut config = CollectorConfig {
            root_pid: u32::MAX,
            sample_interval: None,
            external_processes: HashMap::new(),
        };
        assert!(collector.sample(&config, None).processes.is_empty());

        config.root_pid = std::process::id();
        let snapshot = collector.sample(&config, None);
        let process = snapshot
            .processes
            .iter()
            .find(|process| process.pid == config.root_pid)
            .expect("selected process");

        assert!(!process.command.is_empty());
        assert!(process.resident_bytes > 0);
        assert!(process.cpu_percent.is_finite());
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn keeps_command_lines_and_memory_out_of_the_discovery_table() {
        let mut collector = Collector::new();
        let mut config = CollectorConfig {
            root_pid: u32::MAX,
            sample_interval: None,
            external_processes: HashMap::new(),
        };
        assert!(collector.sample(&config, None).processes.is_empty());

        let pid = Pid::from_u32(std::process::id());
        let unselected = collector.system.process(pid).expect("discovered process");
        assert!(unselected.cmd().is_empty());
        assert_eq!(unselected.memory(), 0);
        assert_eq!(unselected.virtual_memory(), 0);

        config.external_processes = [
            (pid.as_u32(), Some(0)),
            (u32::MAX, None),
            (pid.as_u32(), None),
        ]
        .into_iter()
        .collect();
        let snapshot = collector.sample(&config, None);
        let selected = snapshot
            .processes
            .iter()
            .find(|process| process.pid == pid.as_u32())
            .expect("external process details");
        assert!(!selected.command.is_empty());
        assert!(selected.resident_bytes > 0);
        assert!(selected.start_time_ms > 0);
        assert_eq!(
            snapshot
                .external_processes
                .iter()
                .map(|process| (process.pid, process.start_time_ms))
                .collect::<Vec<_>>(),
            vec![(pid.as_u32(), Some(selected.start_time_ms))],
        );

        config.root_pid = pid.as_u32();
        config.external_processes.insert(pid.as_u32(), Some(0));
        let snapshot = collector.sample(&config, None);
        assert!(snapshot.external_processes.is_empty());
        assert_eq!(
            snapshot
                .processes
                .iter()
                .filter(|process| process.pid == pid.as_u32())
                .count(),
            1,
        );

        let retained = collector
            .system
            .process(pid)
            .expect("retained CPU baseline");
        assert!(retained.cmd().is_empty());
        assert_eq!(retained.memory(), 0);
        assert_eq!(retained.virtual_memory(), 0);
    }

    #[test]
    fn accepts_clock_shifts_without_accepting_reused_process_starts() {
        assert!(matches_process_start_time(10_000, 13_600, 3_600));
        assert!(!matches_process_start_time(10_000, 13_601, 3_600));
        assert!(matches_process_start_time(10_000, 6_400, -3_600));
        assert!(!matches_process_start_time(10_000, 6_401, -3_600));
        assert!(matches_process_start_time(10_000, 10_000, 0));
        assert!(!matches_process_start_time(10_000, 10_001, 0));
    }

    #[test]
    fn decodes_protocol_commands() {
        let configure = serde_json::from_str::<Command>(
            r#"{"version":3,"type":"configure","rootPid":42,"sampleIntervalMs":1000,"externalProcesses":[{"pid":7}]}"#,
        )
        .expect("configure command");

        match configure {
            Command::Configure {
                root_pid,
                sample_interval_ms,
                external_processes,
                ..
            } => {
                assert_eq!(root_pid, 42);
                assert_eq!(sample_interval_ms, 1_000);
                assert_eq!(external_processes[0].pid, 7);
                assert_eq!(external_processes[0].start_time_ms, None);
            }
            _ => panic!("unexpected command"),
        }

        let read_history = serde_json::from_str::<Command>(
            r#"{"version":3,"type":"readHistory","requestId":"history-1","windowMs":60000}"#,
        )
        .expect("read history command");
        assert!(matches!(
            read_history,
            Command::ReadHistory {
                request_id,
                window_ms: 60_000,
                ..
            } if request_id == "history-1"
        ));

        let process_table = serde_json::from_str::<Command>(
            r#"{"version":3,"type":"processTable","requestId":"processes-1"}"#,
        )
        .expect("process table command");
        assert!(matches!(
            process_table,
            Command::ProcessTable { request_id, .. } if request_id == "processes-1"
        ));
    }

    #[test]
    fn clamps_sample_interval() {
        assert_eq!(clamp_sample_interval(0), None);
        assert_eq!(clamp_sample_interval(1), Some(Duration::from_millis(250)));
        assert_eq!(
            clamp_sample_interval(100_000),
            Some(Duration::from_millis(60_000))
        );
    }

    #[test]
    fn counts_selected_processes_that_could_not_be_materialized() {
        assert_eq!(inaccessible_process_count(5, 3), 2);
        assert_eq!(inaccessible_process_count(3, 5), 0);
    }

    #[test]
    fn waits_for_a_cpu_measurement_window_after_priming() {
        let baseline = Instant::now();

        assert_eq!(
            remaining_cpu_measurement_delay(Some(baseline), baseline),
            Some(MINIMUM_CPU_UPDATE_INTERVAL)
        );
        assert_eq!(
            remaining_cpu_measurement_delay(Some(baseline), baseline + MINIMUM_CPU_UPDATE_INTERVAL),
            None
        );
        assert_eq!(remaining_cpu_measurement_delay(None, baseline), None);
    }

    #[test]
    fn retains_bounded_history_without_request_ids() {
        let mut history = HistoryRecorder::default();
        for sequence in 0..=MAX_HISTORY_SNAPSHOTS {
            history.record(&SnapshotEvent {
                version: PROTOCOL_VERSION,
                event_type: "snapshot",
                sequence: sequence as u64,
                sampled_at_unix_ms: sequence as u64 * 1_000,
                collection_duration_micros: 1,
                scanned_process_count: 0,
                retained_process_count: 0,
                inaccessible_process_count: 0,
                request_id: Some("request".to_owned()),
                external_processes: vec![ExternalProcess {
                    pid: 7,
                    start_time_ms: Some(1_000),
                }],
                processes: Vec::new(),
                host: None,
                power_status: None,
            });
        }

        assert_eq!(history.snapshots.len(), MAX_HISTORY_SNAPSHOTS);
        assert!(
            history
                .snapshots
                .iter()
                .all(|snapshot| snapshot.request_id.is_none())
        );
        assert!(history.snapshots.iter().all(|snapshot| {
            snapshot.external_processes.len() == 1
                && snapshot.external_processes[0].pid == 7
                && snapshot.external_processes[0].start_time_ms == Some(1_000)
        }));
        assert_eq!(
            history
                .read(10_000, MAX_HISTORY_SNAPSHOTS as u64 * 1_000)
                .len(),
            11
        );
    }

    #[test]
    fn excludes_and_trims_future_history_after_the_clock_moves_backward() {
        let mut history = HistoryRecorder::default();
        let snapshot = SnapshotEvent {
            version: PROTOCOL_VERSION,
            event_type: "snapshot",
            sequence: 1,
            sampled_at_unix_ms: 2_000,
            collection_duration_micros: 1,
            scanned_process_count: 0,
            retained_process_count: 0,
            inaccessible_process_count: 0,
            request_id: None,
            external_processes: Vec::new(),
            processes: Vec::new(),
            host: None,
            power_status: None,
        };
        history.record(&snapshot);

        assert!(history.read(0, 1_000).is_empty());

        history.record(&SnapshotEvent {
            sequence: 2,
            sampled_at_unix_ms: 1_000,
            ..snapshot
        });
        assert_eq!(history.snapshots.len(), 1);
        assert_eq!(
            history.snapshots.front().map(|entry| entry.sequence),
            Some(2)
        );
    }

    #[test]
    fn bounds_history_by_estimated_process_bytes() {
        let mut history = HistoryRecorder::default();
        let command = "x".repeat(128);
        let process = ProcessSample {
            pid: 1,
            ppid: 0,
            start_time_ms: 0,
            run_time_ms: 0,
            name: "process".to_owned(),
            command,
            status: "Run".to_owned(),
            cpu_percent: 0.0,
            cpu_time_ms: 0,
            resident_bytes: 0,
            virtual_bytes: 0,
            io_read_bytes: 0,
            io_write_bytes: 0,
            io_semantics: IoSemantics::Storage,
        };
        let snapshot_bytes =
            std::mem::size_of::<SnapshotEvent>() + process.estimated_history_bytes();
        for sequence in 0..3 {
            history.record_with_limits(
                &SnapshotEvent {
                    version: PROTOCOL_VERSION,
                    event_type: "snapshot",
                    sequence,
                    sampled_at_unix_ms: sequence * 1_000,
                    collection_duration_micros: 1,
                    scanned_process_count: 1,
                    retained_process_count: 1,
                    inaccessible_process_count: 0,
                    request_id: None,
                    external_processes: Vec::new(),
                    processes: vec![ProcessSample {
                        pid: sequence as u32 + 1,
                        start_time_ms: sequence * 1_000,
                        ..process.clone()
                    }],
                    host: None,
                    power_status: None,
                },
                3,
                3,
                snapshot_bytes * 2,
            );
        }

        assert!(history.retained_bytes <= snapshot_bytes * 2);
        assert_eq!(history.snapshots.len(), 2);
        assert_eq!(
            history.snapshots.front().map(|snapshot| snapshot.sequence),
            Some(1)
        );
    }

    #[test]
    fn counts_external_processes_toward_history_limits() {
        let mut history = HistoryRecorder::default();
        let external_processes = (1..=128)
            .map(|pid| ExternalProcess {
                pid,
                start_time_ms: Some(u64::from(pid) * 1_000),
            })
            .collect::<Vec<_>>();
        let snapshot = SnapshotEvent {
            version: PROTOCOL_VERSION,
            event_type: "snapshot",
            sequence: 0,
            sampled_at_unix_ms: 0,
            collection_duration_micros: 1,
            scanned_process_count: 0,
            retained_process_count: 0,
            inaccessible_process_count: 0,
            request_id: None,
            external_processes,
            processes: Vec::new(),
            host: None,
            power_status: None,
        };
        let snapshot_bytes = snapshot.estimated_history_bytes();
        let snapshot_entries = snapshot.retained_entry_count();

        for sequence in 0..3 {
            history.record_with_limits(
                &SnapshotEvent {
                    sequence,
                    sampled_at_unix_ms: sequence * 1_000,
                    ..snapshot.clone()
                },
                3,
                snapshot_entries * 2,
                snapshot_bytes * 2,
            );
        }

        assert_eq!(history.retained_entry_count, snapshot_entries * 2);
        assert!(history.retained_bytes <= snapshot_bytes * 2);
        assert_eq!(history.snapshots.len(), 2);
        assert_eq!(
            history.snapshots.front().map(|snapshot| snapshot.sequence),
            Some(1)
        );
    }

    #[test]
    fn truncates_process_strings_at_utf8_boundaries() {
        let value = "é".repeat(MAX_PROCESS_NAME_BYTES);
        let truncated = truncate_utf8(value, MAX_PROCESS_NAME_BYTES - 1);

        assert!(truncated.len() < MAX_PROCESS_NAME_BYTES);
        assert!(truncated.is_char_boundary(truncated.len()));
    }

    #[test]
    fn parses_proc_stat_names_with_spaces_and_parentheses() {
        assert_eq!(
            parse_proc_stat(b"4242 (tmux: server) S 1 4242 4242 0 -1 4194560 3101"),
            Some(("tmux: server".to_owned(), 1))
        );
        assert_eq!(
            parse_proc_stat(b"77 (a) b (c)) R 4242 77 77 34816 77 4194304"),
            Some(("a) b (c)".to_owned(), 4242))
        );
        assert_eq!(parse_proc_stat(b"77 (truncated"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_process_table_reports_own_process_like_sysinfo() {
        let mut collector = Collector::new();
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().without_tasks(),
        );
        let own_pid = std::process::id();
        let table = collector.process_table();
        let own = table
            .iter()
            .find(|process| process.pid == own_pid)
            .expect("own process");
        let expected = system
            .process(Pid::from_u32(own_pid))
            .expect("sysinfo own process");
        assert_eq!(own.ppid, expected.parent().map(Pid::as_u32).unwrap_or(0));
        assert_eq!(own.name, expected.name().to_string_lossy());
        assert!(table.windows(2).all(|pair| pair[0].pid < pair[1].pid));
    }

    #[test]
    fn refreshes_commands_without_enumerating_linux_tasks() {
        let refresh_kind = process_refresh_kind();

        assert_eq!(refresh_kind.cmd(), UpdateKind::OnlyIfNotSet);
        assert!(!refresh_kind.tasks());
        assert!(refresh_kind.cpu());
        assert!(refresh_kind.memory());
        assert!(refresh_kind.disk_usage());

        let detail_with_cmd = process_detail_refresh_kind(true);
        assert_eq!(detail_with_cmd.cmd(), UpdateKind::OnlyIfNotSet);
        assert!(!detail_with_cmd.cpu());
        assert!(detail_with_cmd.memory());
        assert!(detail_with_cmd.disk_usage());

        let detail_cached_cmd = process_detail_refresh_kind(false);
        assert_eq!(detail_cached_cmd.cmd(), UpdateKind::Never);
        assert!(!detail_cached_cmd.cpu());
        assert!(detail_cached_cmd.memory());
        assert!(detail_cached_cmd.disk_usage());
    }

    #[test]
    fn decodes_windows_power_status_variants() {
        // Desktop PC on AC without battery
        assert_eq!(
            decode_windows_power_status(1, 128, 255, 0),
            PowerStatus {
                on_battery: Some(false),
                low_power_mode: Some(false),
                battery_percent: None,
                is_charging: None,
            }
        );
        // Laptop plugged in & charging at 84%, Energy Saver off
        assert_eq!(
            decode_windows_power_status(1, 9, 84, 0),
            PowerStatus {
                on_battery: Some(false),
                low_power_mode: Some(false),
                battery_percent: Some(84),
                is_charging: Some(true),
            }
        );
        // Laptop on battery at 19%, Energy Saver ON
        assert_eq!(
            decode_windows_power_status(0, 2, 19, 1),
            PowerStatus {
                on_battery: Some(true),
                low_power_mode: Some(true),
                battery_percent: Some(19),
                is_charging: Some(false),
            }
        );
        // Unknown AC/battery status
        assert_eq!(
            decode_windows_power_status(255, 255, 255, 0),
            PowerStatus {
                on_battery: None,
                low_power_mode: Some(false),
                battery_percent: None,
                is_charging: None,
            }
        );
    }

    #[test]
    fn selects_preferred_cpu_temperature() {
        assert_eq!(
            select_cpu_temperature_celsius([
                ("NVMe SSD", Some(45.2)),
                ("CPU Package", Some(62.46)),
                ("GPU Core", Some(58.0)),
                ("Bad NaN", Some(f32::NAN)),
                ("Bogus High", Some(250.0)),
            ]),
            Some(62.5)
        );
        assert_eq!(
            select_cpu_temperature_celsius([("Board Temp", Some(41.12))]),
            Some(41.1)
        );
        assert_eq!(
            select_cpu_temperature_celsius([("Dead Sensor", None), ("Zero", Some(0.0))]),
            None
        );
    }

    #[test]
    fn reuses_process_table_system_without_kernel_pid_zero() {
        let mut collector = Collector::new();
        let own_pid = std::process::id();
        for _ in 0..2 {
            let table = collector.process_table();
            assert!(table.iter().all(|entry| entry.pid > 0));
            assert!(table.iter().any(|entry| entry.pid == own_pid));
            assert!(table.windows(2).all(|pair| pair[0].pid < pair[1].pid));
        }
    }

    #[test]
    fn sample_now_does_not_postpone_an_existing_periodic_deadline() {
        let now = Instant::now();
        let deadline = now + Duration::from_secs(1);

        assert_eq!(
            sample_now_deadline(
                Some(deadline),
                Some(Duration::from_secs(5)),
                now + Duration::from_millis(100)
            ),
            Some(deadline)
        );
    }

    #[test]
    fn normalizes_cpu_percent_to_total_system_scale() {
        assert!((normalize_cpu_percent(100.0, 32) - 3.125).abs() < 1e-4);
        assert!((normalize_cpu_percent(130.4, 32) - 4.075).abs() < 1e-4);
        assert_eq!(normalize_cpu_percent(3_200.0, 32), 100.0);
        assert_eq!(normalize_cpu_percent(9_999.0, 16), 100.0);
        assert_eq!(normalize_cpu_percent(-5.0, 8), 0.0);
        assert_eq!(normalize_cpu_percent(f32::NAN, 8), 0.0);
        assert_eq!(normalize_cpu_percent(f32::INFINITY, 8), 0.0);
        assert_eq!(normalize_cpu_percent(50.0, 0), 50.0);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_two_stage_collection_populates_host_power_and_stays_fast() {
        assert!(TWO_STAGE_PROCESS_REFRESH);
        let mut collector = Collector::new();
        let config = CollectorConfig {
            root_pid: std::process::id(),
            sample_interval: None,
            external_processes: HashMap::new(),
        };

        let first = collector.sample(&config, None);
        let host = first.host.as_ref().expect("host info");
        assert!(!host.os_name.is_empty());
        assert!(!host.arch.is_empty());
        assert!(host.logical_cores >= 1);
        assert!(host.physical_cores >= 1);
        assert!(host.total_memory_bytes > 0);
        assert!(host.used_memory_bytes > 0);
        assert!(host.uptime_seconds > 0);

        let power = first.power_status.as_ref().expect("windows power status");
        assert!(power.low_power_mode.is_some());

        // Fast Windows NtQuerySystemInformation path never populates sysinfo's process table.
        assert!(collector.system.processes().is_empty());

        let second = collector.sample(&config, None);
        assert_eq!(second.processes.len(), 1);
        assert!(!second.processes[0].command.is_empty());
        assert!(second.processes[0].resident_bytes > 0);
        // Steady-state Windows collection should easily stay well below 8ms (< 8_000 us).
        assert!(
            second.collection_duration_micros < 15_000,
            "expected fast Windows collection, got {} us",
            second.collection_duration_micros
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_private_working_set_is_positive_and_within_working_set() {
        let pid = std::process::id();
        let pws = win_mem::private_working_set_bytes(pid).expect("private working set");
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&[Pid::from_u32(pid)]),
            true,
            ProcessRefreshKind::nothing().with_memory(),
        );
        let ws = system
            .process(Pid::from_u32(pid))
            .expect("self process")
            .memory();
        assert!(pws > 0, "expected positive private working set, got {pws}");
        assert!(
            pws <= ws,
            "expected private working set ({pws}) <= total working set ({ws})"
        );
    }
}
