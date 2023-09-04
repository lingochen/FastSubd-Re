duplicate uvs for each hEdge takes less space and much simpler to subdivide.

The problem of using index to point to uv is that indexUv does not provide enough info, where do we put the newly subdivide uv? We needs to have some edge like structures to get parallel subdivision to works. so each halfEdge use index which point to uvEdge which point to the real uv. It 2 indirection, 2 index per uv, and much more complicate logics to subdivide. Furthermore, uv islands is common which use a lot of boundary edges, which needs special logic to handle properly.

So we stay with the simple attributes per hEdge.