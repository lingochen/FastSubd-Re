[design](design_note.md)

as of today (2023/08/30)

multiple js webworkers working the same SharedBufferArray turn out to be very slow. It seems that you have to partition into separate non-overlapping views in order to get speedup.

use wasm to avoid the overhead.