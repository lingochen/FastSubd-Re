[readme](../README.md) | [api](api.md)

## basics
- ### vertex
    - v.halfEdge
    - v.length
    - v.valence
    - v.crease

- ### halfEdge
    - h.pair
    - h.next
    - h.prev
    - h.vertex
    - h.wEdge
    - h.face
    - h.length
    - h.wLength

- ### face
    - f.halfEdge
    - f.length

## memory mangament of vertex/hEdge/face of SurfaceMesh.
- ### alloc
    - #### addVertex
    - #### addFace
    - #### v._appendNew
    - #### v._appendNewRange

## navigation
traversal of vertex, edge, and face.

- ### circulator
    - #### around a vertex
        - v.faceAround
        - v.wEdgeAround
        - v.vertexAround
        - v.inHalfEdgeAround
        - v.outHalfEdgeAround

    - #### around an edge
        - h.left
        - h.right
        - h.leftFace
        - h.rightFace
        - h.origin
        - h.destination

    - #### around a face
        - f.vertexLoop
        - f.halfEdgeLoop
        - f.halfEdgeLoopEntries
        - f.wEdgeLoop
        - f.faceAround

- ### iterator
    - #### vertex
        - *v
        - v.rangeIter
    - #### edge
        - *h
        - h.rangeIter
        - h.halfEdgeIter
        - h.boundaryIter
    - #### face
        - *f
        - f.rangeIter

## postprocess

### optimized,

### compaction
mesh.compact

## mutation
f.flip

