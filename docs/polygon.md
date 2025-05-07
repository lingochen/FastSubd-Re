[readme](../README.md) | [roadmap](roadmap.md) | [design](design_note.md) | [api](api.md) | [reference](reference.md)

Why?

Still a lot of models is not triangles.

Polygon editing, such as bevel, eeee, is more naturally done in Polygon than triangle.


How? Migration.

directed edges/boundary loop become internal implementation. hide it. (@done, 2025/05)

exposed WholeEdge/HalfEdge, use WholeEdge/HalfEdge api to manipulated polyogn. 

WholeEdge mark as polygon edge or internal edge. 

fit triangles to polygon. (support general triangulation at later date?)
