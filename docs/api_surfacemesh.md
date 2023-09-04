[readme](../README.md) | [api](api.md)

## basics

### halfEdge
h.pair
h.next
h.prev
h.vertex
h.wEdge
h.face
h.length
h.wLength

### vertex
v.halfEdge
v.length
v.valence
v.crease

### face
f.halfEdge
f.length

## allocation/free


## navigation
traversal of vertex, edge, and face.

### circulator
#### around a vertex
v.faceAround
v.wEdgeAround
v.vertexAround
v.inHalfEdgeAround
v.outHalfEdgeAround

#### around an edge
h.left
h.right
h.leftFace
h.rightFace
h.origin
h.destination


#### around a face
f.vertexLoop
f.halfEdgeLoop
f.wEdgeLoop
f.faceAround

### iterator
*v
v.range
*h
h.range
*f
f.range

## postprocess

### optimized,

### compaction
mesh.compact

## mutation
f.flip

