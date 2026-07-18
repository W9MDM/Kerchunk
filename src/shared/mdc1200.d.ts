/**
 * MDC1200 burst encoder/decoder — a clean-room, MIT-licensed implementation of
 * Motorola's MDC1200 signaling, written from the documented wire format:
 *
 *   - Payload: op, arg, unitID(hi), unitID(lo)  (4 bytes)
 *   - CRC-16 poly 0x1021, reflected in/out, final XOR 0xffff, over the 4 bytes
 *   - 7-stage convolutional FEC (feedback taps 0,2,5,6) → 7 parity bytes
 *   - bit interleave with a stride of 16 across the 14 bytes (112 bits)
 *   - leader: 0x55 × 7 (clock) + sync 0x07 0x09 0x2a 0x44 0x6f
 *   - modulation: 1200 baud differential MSK, 1200 Hz (no change) / 1800 Hz
 *     (change), continuous phase, bits sent MSB-first.
 *
 * NOT derived from any GPL source — implemented independently from the protocol
 * description. Interoperates with itself (round-trip tested); verify against a
 * real Motorola radio before relying on off-air interop.
 */
/** Common MDC1200 opcode/arg for a PTT ID (unit identifies itself). */
export declare const MDC_OP_PTT_ID = 1;
export declare const MDC_ARG_PTT_ID = 0;
/** MDC1200 CRC: CRC-16/1021, input bytes reflected, output reflected then inverted. */
export declare function mdcCrc(bytes: number[]): number;
/** Build the 14 transmitted bytes (FEC + interleave) for a packet. */
export declare function buildMdcFrame(op: number, arg: number, unitId: number): number[];
/** Encode an MDC1200 burst to PCM (Int16) at the given sample rate. */
export declare function encodeMdcBurst(unitId: number, op?: number, arg?: number, sampleRate?: number, amplitude?: number): Int16Array;
export interface MdcPacket {
    op: number;
    arg: number;
    unitId: number;
}
/**
 * Scan a block of audio for MDC1200 bursts. Brute-forces the sub-bit start
 * offset and validates via CRC, so only correctly-decoded packets are returned.
 */
export declare function decodeMdcBursts(input: Int16Array | Float32Array, sampleRate?: number): MdcPacket[];
/** Format a unit ID as the conventional 4-digit uppercase hex. */
export declare function formatUnitId(unitId: number): string;
/** Parse a user-entered unit ID ("1234" hex) to a number, or null if invalid. */
export declare function parseUnitId(text: string): number | null;
