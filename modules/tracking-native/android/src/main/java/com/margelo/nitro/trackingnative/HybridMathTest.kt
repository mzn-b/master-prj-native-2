package com.margelo.nitro.trackingnative



/**
 * Smoke-test implementation proving the Nitro pipeline end to end.
 * Removed in Task 12 together with the MathTest spec.
 */
class HybridMathTest : HybridMathTestSpec() {
  override fun add(a: Double, b: Double): Double = a + b
}
