// TODO:
// Cleanup API for choosing coordinate systems.
// Position (currently Origin) is in slide.
//   I want to extend this to Viewer.
//   Relative to corners or center and
//   possibly relative to left, right of shape ... like css
// Currently we use FixedSize to choose width and height units.

// For the sort term I need an option to have position relative to upper
// left of the viewer.

(function () {
  'use strict';

  function Shape () {
    this.Orientation = 0.0; // in degrees, counter clockwise, 0 is left
    this.PositionCoordinateSystem = Shape.SLIDE;
    // This is the position of the shape origin in the containing
    // coordinate system. Probably better called position.
    this.Origin = [10000, 10000]; // Anchor in world coordinates.
    // FixedSize => PointBuffer units in viewer pixels.
    // otherwise
    this.FixedSize = false;
    this.FixedOrientation = false;
    this.LineWidth = 0; // Line width has to be in same coordinates as points.
    this.Visibility = true; // An easy way to turn off a shape (with removing it from the shapeList).
    this.Selected = false;
    this.SelectedColor = [1.0, 1.0, 0.0];
    // Playing around with layering.  The anchor is being obscured by the text.
    this.ZOffset = 0.1;

    // Grouping shapes.
    // TODO: Change widgets to interactors (that can deal with multiple shapes).
    this.Children = {};
  }

  Shape.prototype.GetLineWidth = function () {
    return this.LineWidth;
  };

  Shape.prototype.GetOrigin = function () {
    return this.Origin;
  };

  // in degrees
  Shape.prototype.GetOrientation = function () {
    return this.Orientation;
  };

  // in radians
  Shape.prototype.GetRotation = function () {
    return this.Orientation * Math.PI / 180.0;
  };

  Shape.prototype.Modified = function () {
    this.Matrix = undefined;
  };

  Shape.prototype.DeleteSelected = function () {
    for (var name in this.Children) {
      if (this.Children[name].DeleteSelected()) {
        delete this.Children[name];
      }
    }
    if (this.IsSelected()) {
      this.PointBuffer = undefined;
      return true;
    }
    return false;
  };

  Shape.prototype.IsEmpty = function () {
    return this.PointBuffer === undefined;
  };

  // Coordinate Systems
  Shape.SLIDE = 0; // Pixel of highest resolution level.
  Shape.VIEWER = 1; // Pixel of viewer canvas.

  Shape.prototype.destructor = function () {
    // Get rid of the buffers?
  };

  // Returns true if the selected state changed.
  Shape.prototype.SetSelected = function (f) {
    if (f === this.Selected) { return false; }
    this.Selected = f;
    // When a parent is selected, the children are highligted too.
    for (var childKey in this.Children) {
      var child = this.Children[childKey];
      child.SetSelected(f);
    }

    return true;
  };

  Shape.prototype.IsSelected = function () {
    return this.Selected;
  };

  Shape.prototype.Draw = function (view) {
    if (!this.Visibility) {
      return;
    }
    if (this.Matrix === undefined) {
      this.UpdateBuffers(view);
    }

    if (this.IsEmpty()) {
      return;
    }

    var theta;
    var m;
    var x;
    var y;
    if (view.gl) {
      // Lets use the camera to change coordinate system to pixels.
      // TODO: Put this camera in the view or viewer to avoid creating one each render.
      var camMatrix = mat4.create();
      mat4.identity(camMatrix);
      if (this.FixedSize) {
        var viewFrontZ = view.Camera.ZRange[0] + 0.01;
        // This camera matrix changes pixel/ screen coordinate system to
        // view [-1,1],[-1,1],z
        camMatrix[0] = 2.0 / view.Viewport[2];
        camMatrix[12] = -1.0;
        camMatrix[5] = -2.0 / view.Viewport[3];
        camMatrix[13] = 1.0;
        camMatrix[14] = viewFrontZ; // In front of tiles in this view
      }

      // The actor matrix that rotates to orientation and shift (0,0) to origin.
      // Rotate based on ivar orientation.
      theta = this.Orientation * 3.1415926536 / 180.0;
      this.Matrix[0] = Math.cos(theta);
      this.Matrix[1] = -Math.sin(theta);
      this.Matrix[4] = Math.sin(theta);
      this.Matrix[5] = Math.cos(theta);
      // Place the origin of the shape.
      x = this.Origin[0];
      y = this.Origin[1];
      if (this.FixedSize) {
        // For fixed size, translation must be in view/pixel coordinates.
        // First transform the world to view.
        m = view.Camera.Matrix;
        x = (this.Origin[0] * m[0] + this.Origin[1] * m[4] + m[12]) / m[15];
        y = (this.Origin[0] * m[1] + this.Origin[1] * m[5] + m[13]) / m[15];
        // convert view to pixels (view coordinate system).
        x = view.Viewport[2] * (0.5 * (1.0 + x));
        y = view.Viewport[3] * (0.5 * (1.0 - y));
      }
      // Translate to place the origin.
      this.Matrix[12] = x;
      this.Matrix[13] = y;
      this.Matrix[14] = this.ZOffset;

      var program = SA.polyProgram;

      view.gl.useProgram(program);
      view.gl.disable(view.gl.BLEND);
      view.gl.enable(view.gl.DEPTH_TEST);

      // This does not work.
      // I will need to make thick lines with polygons.
      // view.gl.lineWidth(5);

      // These are the same for every tile.
      // Vertex points (shifted by tiles matrix)
      view.gl.bindBuffer(view.gl.ARRAY_BUFFER, this.VertexPositionBuffer);
      // Needed for outline ??? For some reason, DrawOutline did not work
      // without this call first.
      view.gl.vertexAttribPointer(program.vertexPositionAttribute,
                                   this.VertexPositionBuffer.itemSize,
                                   view.gl.FLOAT, false, 0, 0);     // Texture coordinates
      // Local view.
      view.gl.viewport(view.Viewport[0], view.Viewport[1],
                        view.Viewport[2], view.Viewport[3]);

      view.gl.uniformMatrix4fv(program.mvMatrixUniform, false, this.Matrix);
      if (this.FixedSize) {
        view.gl.uniformMatrix4fv(program.pMatrixUniform, false, camMatrix);
      } else {
        // Use main views camera to convert world to view.
        view.gl.uniformMatrix4fv(program.pMatrixUniform, false, view.Camera.GetImageMatrix());
      }

      // Fill color
      if (this.FillColor !== undefined) {
        if (this.Selected) {
          view.gl.uniform3f(program.colorUniform, this.SelectedColor[0],
                                 this.SelectedColor[1], this.SelectedColor[2]);
        } else {
          view.gl.uniform3f(program.colorUniform, this.FillColor[0],
                                 this.FillColor[1], this.FillColor[2]);
        }
        // Cell Connectivity
        view.gl.bindBuffer(view.gl.ELEMENT_ARRAY_BUFFER, this.CellBuffer);

        view.gl.drawElements(view.gl.TRIANGLES, this.CellBuffer.numItems,
                                view.gl.UNSIGNED_SHORT, 0);
      }

      if (this.OutlineColor !== undefined) {
        if (this.Selected) {
          view.gl.uniform3f(program.colorUniform, this.SelectedColor[0],
                                 this.SelectedColor[1], this.SelectedColor[2]);
        } else {
          view.gl.uniform3f(program.colorUniform, this.OutlineColor[0],
                                 this.OutlineColor[1], this.OutlineColor[2]);
        }

        if (this.LineWidth === 0) {
          if (this.WireFrame) {
            view.gl.bindBuffer(view.gl.ELEMENT_ARRAY_BUFFER, this.CellBuffer);
            view.gl.drawElements(view.gl.LINE_LOOP, this.CellBuffer.numItems,
                                        view.gl.UNSIGNED_SHORT, 0);
          } else {
            // Outline. This only works for polylines
            view.gl.drawArrays(view.gl.LINE_STRIP, 0, this.VertexPositionBuffer.numItems);
          }
        } else {
          // Cell Connectivity
          view.gl.bindBuffer(view.gl.ELEMENT_ARRAY_BUFFER, this.LineCellBuffer);
          view.gl.drawElements(view.gl.TRIANGLES, this.LineCellBuffer.numItems,
                                    view.gl.UNSIGNED_SHORT, 0);
        }
      }
    } else { // 2d Canvas -----------------------------------------------
      view.Context2d.save();
      // Identity.
      view.Context2d.setTransform(1, 0, 0, 1, 0, 0);

      var scale;
      if (this.PositionCoordinateSystem === Shape.SLIDE) {
        theta = (this.Orientation * 3.1415926536 / 180.0);
        if (!this.FixedSize) {
          theta -= view.Camera.GetImageRoll();
        }
        this.Matrix[0] = Math.cos(theta);
        this.Matrix[1] = -Math.sin(theta);
        this.Matrix[4] = Math.sin(theta);
        this.Matrix[5] = Math.cos(theta);
        // Place the origin of the shape.
        x = this.Origin[0];
        y = this.Origin[1];
        scale = 1.0;
        if (!this.FixedSize) {
          // World need to be drawn in view coordinate system so the
          scale = view.Viewport[3] / view.Camera.GetHeight();
        }
        // First transform the origin-world to view.
        m = view.Camera.GetImageMatrix();
        x = (this.Origin[0] * m[0] + this.Origin[1] * m[4] + m[12]) / m[15];
        y = (this.Origin[0] * m[1] + this.Origin[1] * m[5] + m[13]) / m[15];

        // convert origin-view to pixels (view coordinate system).
        x = view.Viewport[2] * (0.5 * (1.0 + x));
        y = view.Viewport[3] * (0.5 * (1.0 - y));
        view.Context2d.transform(this.Matrix[0], this.Matrix[1], this.Matrix[4], this.Matrix[5], x, y);
      } else if (this.PositionCoordinateSystem === Shape.VIEWER) {
        theta = (this.Orientation * 3.1415926536 / 180.0);
        this.Matrix[0] = Math.cos(theta);
        this.Matrix[1] = -Math.sin(theta);
        this.Matrix[4] = Math.sin(theta);
        this.Matrix[5] = Math.cos(theta);
        // Place the origin of the shape.
        x = this.Origin[0];
        y = this.Origin[1];
        scale = 1.0;

        view.Context2d.transform(this.Matrix[0], this.Matrix[1], this.Matrix[4], this.Matrix[5], x, y);
      }

      // Right now this is specific to a rectangle.
      // It is here because I need the transformation.  It could be generalized...
      if (this.Image && this.Image.complete && this.Width && this.Height) {
        view.Context2d.save();
        // Scale the image to match the rectangle
        var a = this.Width * scale / this.Image.width;
        var d = this.Height * scale / this.Image.height;
        // move the origin to the corner of the image.
        var e = -this.Width * scale / 2.0;
        var f = -this.Height * scale / 2.0;
        // a c e
        // b d f
        view.Context2d.transform(a, 0, 0, d, e, f);
        view.Context2d.drawImage(this.Image, 0, 0);
        view.Context2d.restore();
      }

      // for debugging section alignment.
      var x0 = this.PointBuffer[0];
      var y0 = this.PointBuffer[1];
      // For debugging gradient decent aligning contours.
      // This could be put into the canvas transform, but it is only for debugging.
      // if (this.Trans) {
      //      var vx = x0-this.Trans.cx;
      //      var vy = y0-this.Trans.cy;
      //      var rx =  this.Trans.c*vx + this.Trans.s*vy;
      //      var ry = -this.Trans.s*vx + this.Trans.c*vy;
      //      x0 = x0 + (rx-vx) + this.Trans.sx;
      //      y0 = y0 + (ry-vy) + this.Trans.sy;
      // }

      // This gets remove when the debug code is uncommented.
      view.Context2d.beginPath();
      view.Context2d.moveTo(x0 * scale, y0 * scale);

      var i = 3;
      while (i < this.PointBuffer.length) {
        var x1 = this.PointBuffer[i];
        var y1 = this.PointBuffer[i + 1];
        // For debugging.  Apply a transformation and color by scalars.
        // if (this.Trans) {
        //    var vx = x1-this.Trans.cx;
        //    var vy = y1-this.Trans.cy;
        //    var rx =  this.Trans.c*vx + this.Trans.s*vy;
        //    var ry = -this.Trans.s*vx + this.Trans.c*vy;
        //    x1 = x1 + (rx-vx) + this.Trans.sx;
        //    y1 = y1 + (ry-vy) + this.Trans.sy;
        // }
        // view.Context2d.beginPath();
        // view.Context2d.moveTo(x0*scale,y0*scale);
        // Also for debugging
        // if (this.DebugScalars) {
        //    view.Context2d.strokeStyle=SAM.ConvertColorToHex([1,this.DebugScalars[i/3], 0]);
        // } else {
        //    view.Context2d.strokeStyle=SAM.ConvertColorToHex(this.OutlineColor);
        // }
        // view.Context2d.stroke();
        // x0 = x1;
        // y0 = y1;

        // This gets remove when the debug code is uncommented.
        view.Context2d.lineTo(x1 * scale, y1 * scale);

        i += 3;
      }

      if (this.OutlineColor !== undefined) {
        var width = this.LineWidth * scale;
        if (width === 0) {
          width = 1;
        }
        view.Context2d.lineWidth = width;
        if (this.Selected) {
          view.Context2d.strokeStyle = SAM.ConvertColorToHex(this.SelectedColor);
        } else {
          view.Context2d.strokeStyle = SAM.ConvertColorToHex(this.OutlineColor);
        }
        // This gets remove when the debug code is uncommented.
        view.Context2d.stroke();
      }

      if (this.FillColor !== undefined) {
        if (this.Selected) {
          view.Context2d.fillStyle = SAM.ConvertColorToHex(this.SelectedColor);
        } else {
          view.Context2d.fillStyle = SAM.ConvertColorToHex(this.FillColor);
        }
        view.Context2d.fill();
      }

      view.Context2d.restore();
    }
    for (var name in this.Children) {
      if (this.Children[name] && this.Children[name].Draw) {
        this.Children[name].Draw(view);
      }
    }
  };

  // Invert the fill color.
  Shape.prototype.ChooseOutlineColor = function () {
    if (this.FillColor) {
      this.OutlineColor = [1.0 - this.FillColor[0],
        1.0 - this.FillColor[1],
        1.0 - this.FillColor[2]];
    }
  };

  Shape.prototype.SetOrigin = function (o) {
    this.Origin = o.slice();
  };

  Shape.prototype.SetOutlineColor = function (c) {
    this.OutlineColor = SAM.ConvertColor(c);
  };

  Shape.prototype.GetOutlineColor = function (c) {
    return this.OutlineColor;
  };

  Shape.prototype.SetFillColor = function (c) {
    this.FillColor = SAM.ConvertColor(c);
  };

  Shape.prototype.HandleMouseMove = function (event, dx, dy) {
    // superclass does nothing
    return false;
  };

  // Shape.prototype.UpdateBuffers = function(view) {
  //    // The superclass does not implement this method.
  // }

  // Returns undefined if the point is not on the segment.
  // Returns the interpolation index if it is touching the edge.
  // NOTE: Confusion between undefined and 0. I could return -1 ...???...
  // However -1 could mean extrapolation ....
  Shape.prototype.IntersectPointLine = function (pt, end0, end1, dist) {
    // make end0 the origin.
    var x = pt[0] - end0[0];
    var y = pt[1] - end0[1];
    var vx = end1[0] - end0[0];
    var vy = end1[1] - end0[1];

    // Rotate so the edge lies on the x axis.
    var length = Math.sqrt(vx * vx + vy * vy); // Avoid atan2 ... by rotating with complex numbers
    if (length === 0) {
      return undefined;
    }

    // Get the edge normal direction.
    vx = vx / length;
    vy = -vy / length;
    // Rotate the coordinate system to put the edge on the x axis.
    var newX = (x * vx - y * vy);
    var newY = (x * vy + y * vx);

    if (Math.abs(newY) > dist ||
            newX < 0 || newX > length) {
      return undefined;
    }
    return newX / length;
  };

  SAM.Shape = Shape;
})();
