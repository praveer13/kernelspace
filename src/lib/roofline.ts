/**
 * Roofline arithmetic shared by the matmul-tiling lesson and sim-roofline
 * (PLAN-100X §6.1 erratum #7: tiled intensity was stated three different ways).
 */

/**
 * Arithmetic intensity (FLOP/byte) of a square `tile × tile` output tile of a
 * matmul whose operands are read from HBM once per tile.
 *
 * Derivation: marching K steps, the tile does `2 · tile² · K` FLOPs (one
 * multiply-add per output element per k) and loads a `tile × K` slab of A and
 * a `K × tile` slab of B, `2 · tile · K · bytesPerElement` bytes. The ratio is
 * `tile / bytesPerElement`: T/2 FLOP/byte for FP16 (2 bytes), T/4 for FP32.
 * The C tile stays in registers and is written once, so it does not count.
 */
export const tiledIntensity = (tile: number, bytesPerElement: number): number =>
  tile / bytesPerElement
