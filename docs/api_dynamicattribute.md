[readme](../README.md) | [api](api.md)

similar to "Polygon Mesh Processing Library"

## dynamic property creation
- v.addProperty(name, type)
- h.addProperty(name, type)
- f.addProperty(name, type)

## dynamic property deletion
- v.removeProperty(name)
- h.removeProperty(name)
- f.removeProperty(name)

## dynamic property access, return PixelArray or DoubleBuffer for direct access.
- v.getProperty(name)
- h.getProperty(name)
- f.getProperty(name)

## DoubleBuffer class to handle get/set functions.
- property.get(handle)
- property.getXXX(handle) - custom defined
- property.set(handle, value)
- property.setXXX(handle, value) - custom defined
- property.getBuffer()