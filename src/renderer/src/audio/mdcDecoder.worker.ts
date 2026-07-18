/// <reference lib="webworker" />
// Decodes MDC1200 bursts off the main thread so the CRC-gated brute-force search
// can never block mic-frame handoff (which would starve outbound audio).
import { decodeMdcBursts, formatUnitId } from '../../../shared/mdc1200';

self.onmessage = (event: MessageEvent<Int16Array>) => {
  const samples = event.data;
  const packets = decodeMdcBursts(samples);
  if (packets.length > 0) {
    (self as unknown as Worker).postMessage(packets.map((p) => formatUnitId(p.unitId)));
  }
};
