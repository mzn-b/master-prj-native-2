import NitroModules

/// Smoke-test implementation proving the Nitro pipeline end to end.
/// Removed in Task 12 together with the MathTest spec.
class HybridMathTest: HybridMathTestSpec {
  func add(a: Double, b: Double) throws -> Double {
    return a + b
  }
}
