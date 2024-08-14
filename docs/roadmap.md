[readme](../README.md)  | [design](design_note.md) | [api](api.md) | [reference](reference.md)

# FastSubd: Reboot (2023/06/15)

- <s>use DirectedEdgeArray only for performance and simplicity (only one implementation of data structure)<s>

- <s>webworker parallel subidivision support. </s>, @done (2023/08/26)[insight](multithread.md)

- refactor to have a sane API. write documentation, @onGoing (2023/09/04)[api](api.md)

- <s>finish boundaryLoop subdivide support</s> @done (2023/09/16)

- <s>[dynamic properties](api_dynamicattribute.md) support</s> @done (2023/10/05)

- <s>Pixel buffer reorganization and rethinking [Pixel Buffer](pixelmemory.md)</s> @done (2024/02/20)

- <s>refactor DirectedEdgeArray. add (pair/twin) data memeber since it a fairly common operation to refernce pair.</s> @done (2024/08/10)- no speedup, going to drop it.

- [MeshColors PatchTexture](meshcolors.md)

- <s>Modified Butterfly scheme support</s> - drop

- <s>Catmull-Clark scheme support</s> - drop

- <s>More file formats support.</s> - drop

- Complete PBR material support and rendering.

- using [wasm](dwasm.md) to do parallel subdivision. Use wasm with D language.

- Displaced Subdivision Surface?

- webgpu compute shader?

- adaptive subdivision using compute shader. compute subdivisions then compute the adpative lod.

