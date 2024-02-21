[design](design_note.md)

PixelArray Buffer

Design consideration

purpose is to provide a typedarray buffer that is manipulated on cpu side but in a format that is easily upload to gpu.

gpu drawing data/operation is pulled from the buffer(texture).

try to consolidate various buffers of SurfaceMesh into one giant buffer if not editing. fewer allocation/deallocation, more efficient use of memory.

dynamic allocation/deallocation is still possible for Mesh editing purpose.


API

SurfaceMesh.reserve() function support one static buffer for all(vertex, halfEdge, face) to use.

setBuffer() function for allocating memory buffer. either dynamic or static.

pixelmemory stacked vertically in gpu because update become simpler for partial upload to GPU. (@done, 2024/02/09)

<s> eliminated DoubleBuffer, let negative ptr start from end of bufferA, reuse the same buffer. needs to rewrite shader code too? </s> Just eliminate DoubleBuffer, CC subdivision won't mixed boundary edge and triangle edge. (2024/02/20)

checked if memory alignment really cached aligned.