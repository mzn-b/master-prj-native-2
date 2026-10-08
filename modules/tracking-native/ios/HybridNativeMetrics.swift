import Foundation
import NitroModules
import UIKit

/// OS-level metrics on iOS.
///
/// Battery is scaled to a percentage (0..100) to match Android — UIDevice
/// reports a 0..1 fraction, and mixing the two is what put three different
/// units into one database column in the existing apps.
final class HybridNativeMetrics: HybridNativeMetricsSpec {

  override init() {
    super.init()
    UIDevice.current.isBatteryMonitoringEnabled = true
  }

  func snapshot() throws -> NativeMetricsSnapshot {
    let processInfo = ProcessInfo.processInfo
    let batteryLevel = UIDevice.current.batteryLevel
    let charging = UIDevice.current.batteryState == .charging
      || UIDevice.current.batteryState == .full

    return NativeMetricsSnapshot(
      cpuUsagePercent: Self.cpuUsagePercent(),
      memoryUsedMB: Self.residentMemoryMB(),
      totalMemoryMB: Double(processInfo.physicalMemory) / Self.bytesPerMB,
      availableMemoryMB: nil,
      cpuCores: Double(processInfo.activeProcessorCount),
      threadCount: Self.threadCount(),
      thermalState: Self.thermalName(processInfo.thermalState),
      // -1 means the OS declined to report it (e.g. monitoring disabled).
      batteryLevel: batteryLevel >= 0 ? Double(batteryLevel) * 100 : nil,
      batteryCharging: charging,
      gpuVendor: "Apple",
      // Apple does not name the GPU separately; the machine identifier is the
      // closest thing, and it does identify the GPU generation.
      gpuRenderer: Self.deviceModel(),
      // e.g. "iPhone14,6". Not the marketing name, but it names the handset
      // unambiguously, which the literal "iOS device" it replaces did not.
      deviceModel: Self.deviceModel()
    )
  }

  private static let bytesPerMB = 1024.0 * 1024.0

  private static func thermalName(_ state: ProcessInfo.ThermalState) -> String {
    switch state {
    case .nominal: return "nominal"
    case .fair: return "fair"
    case .serious: return "serious"
    case .critical: return "critical"
    @unknown default: return "nominal"
    }
  }

  private static func residentMemoryMB() -> Double? {
    var info = mach_task_basic_info()
    var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
    let result = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
        task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
      }
    }
    guard result == KERN_SUCCESS else { return nil }
    return Double(info.resident_size) / bytesPerMB
  }

  private static func threadCount() -> Double? {
    var threads: thread_act_array_t?
    var count = mach_msg_type_number_t(0)
    guard task_threads(mach_task_self_, &threads, &count) == KERN_SUCCESS else { return nil }
    if let threads {
      vm_deallocate(
        mach_task_self_,
        vm_address_t(UInt(bitPattern: threads)),
        vm_size_t(Int(count) * MemoryLayout<thread_t>.stride)
      )
    }
    return Double(count)
  }

  /// Sum of per-thread CPU usage for this process.
  private static func cpuUsagePercent() -> Double? {
    var threads: thread_act_array_t?
    var count = mach_msg_type_number_t(0)
    guard task_threads(mach_task_self_, &threads, &count) == KERN_SUCCESS, let threads else {
      return nil
    }
    defer {
      vm_deallocate(
        mach_task_self_,
        vm_address_t(UInt(bitPattern: threads)),
        vm_size_t(Int(count) * MemoryLayout<thread_t>.stride)
      )
    }

    var total = 0.0
    for index in 0..<Int(count) {
      var info = thread_basic_info()
      var infoCount = mach_msg_type_number_t(THREAD_INFO_MAX)
      let result = withUnsafeMutablePointer(to: &info) {
        $0.withMemoryRebound(to: integer_t.self, capacity: Int(infoCount)) {
          thread_info(threads[index], thread_flavor_t(THREAD_BASIC_INFO), $0, &infoCount)
        }
      }
      if result == KERN_SUCCESS, info.flags & TH_FLAGS_IDLE == 0 {
        total += Double(info.cpu_usage) / Double(TH_USAGE_SCALE) * 100.0
      }
    }
    return total
  }

  private static func deviceModel() -> String {
    var info = utsname()
    uname(&info)
    return withUnsafePointer(to: &info.machine) {
      $0.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
    }
  }
}
