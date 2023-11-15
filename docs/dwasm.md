steps to dlang wasm workers

1. ### central alloc to replace separate allocation of SurfaceMesh's internal array.

2. ### use wasm shared memory to replaced sharedarraybuffer.
    - used wasm shared memory, provided a standard api for alloc/free/realloc. simulated using js.
    - FinalizationRegistration for freeing memory. Not ideal solution, but it what we have.
    - replace sharedarraybuffer.

3. ### port wasm memory management api to dlang wasm? or may be we should use wasm directly to learn about it

4. ### simple wasm workers management with shared memory.

5. ### implement wasm.d subdivide functions, one by one.