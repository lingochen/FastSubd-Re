[readme](../README.md)  | [roadmap](roadmap.md) | [api](api.md) | [reference](reference.md)

Consideration, Goal,

unify representation for rendering and editing. simple data structure, yet fast subdivision.

direct subdivision from editable mesh.

contiguous sequential array update, (performance)

DirectedEdge Array, (performance, easy update, subdivision)

use ptex/htex 

avoid false sharing

parallel implementation (gpu), [cpu](multithread.md)

wasm, (sharedtypearray is slow?)

good name, [sane api](api.md)

Limitation, PitFall

directededge must be contiguous without hole or freed space.

so we needs another layer to handle the editing operation, and the underlying data can be optimized and contiguous.



[UV TexCoord Attribute](uv_texcoord.md)

[PTex HTex](ptexhtex.md)

[HalfEdge Array](halfedge.md)

[DirectedEdge Array](directededge.md)

[Reference](reference.md)