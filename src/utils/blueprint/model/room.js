import {
  EVENT_CHANGED,
  EVENT_ROOM_ATTRIBUTES_CHANGED,
} from '../core/events.js';
import { Region } from '../core/utils.js';
import {
  EventDispatcher,
  Vector2,
  Vector3,
  Face3,
  Geometry,
  Shape,
  ShapeGeometry,
  Mesh,
  MeshBasicMaterial,
  DoubleSide,
  Box3,
} from 'three';

//import { grahamScan2 } from '@thi.ng/geom-hull';
//import * as concaveman from 'concaveman';

import { WallTypes } from '../core/constants.js';

import { Utils } from '../core/utils.js';
import { HalfEdge } from './half.edge.js';

/* Default texture to be used if nothing is provided. */
export const defaultRoomTexture = {
  url: 'assets/rooms/textures/hardwood.png',
  scale: 400,
};

/*
 * A Room is the combination of a Floorplan with a floor plane.
 */
export class Room extends EventDispatcher {
  /*
   *  ordered CCW
   */
  constructor(floorplan, corners) {
    super();
    this._name = 'A New Room';
    this.min = null;
    this.max = null;
    this.center = null;
    this.area = 0.0;
    this.areaCenter = null;
    this._polygonPoints = [];

    this.floorplan = floorplan;
    this.corners = corners;
    this.interiorCorners = [];
    this.edgePointer = null;
    this.floorPlane = null;
    this.roofPlane = null;
    this.customTexture = false;
    this.floorChangeCallbacks = null;

    let cornerIds = [];
    for (let i = 0; i < this.corners.length; i++) {
      let c = this.corners[i];
      c.attachRoom(this);
      cornerIds.push(c.id);
    }
    this._roomByCornersId = cornerIds.join(',');

    this.update();
  }

  get roomCornerPoints() {
    return this._polygonPoints;
  }

  get roomByCornersId() {
    return this._roomByCornersId;
  }

  set name(value) {
    let oldName = this._name;
    this._name = value;
    this.dispatchEvent({
      type: EVENT_ROOM_ATTRIBUTES_CHANGED,
      item: this,
      info: { from: oldName, to: this._name },
    });
  }
  get name() {
    return this._name;
  }

  update() {
    this.updateWalls();
    this.updateInteriorCorners();
    this.generatePlane();
    this.generateRoofPlane();
  }

  roomIdentifier() {
    let cornerIds = [];
    this.corners.forEach((corner) => {
      cornerIds.push(corner.id);
    });
    let ids = cornerIds.join(',');
    return ids;
  }

  getUuid() {
    let cornerUuids = Utils.map(this.corners, function (c) {
      return c.id;
    });
    cornerUuids.sort();
    return cornerUuids.join();
  }

  fireOnFloorChange(callback) {
    this.floorChangeCallbacks.add(callback);
  }

  getTexture() {
    let uuid = this.getUuid();
    let tex = this.floorplan.getFloorTexture(uuid);
    return tex || defaultRoomTexture;
  }

  showWallsTexture() {
    let edge = this.edgePointer;
    let iterateWhile = true;
    edge.showCurTexture();
    while (iterateWhile) {
      if (edge.next === this.edgePointer) {
        break;
      } else {
        edge = edge.next;
      }
      edge.showCurTexture();
    }
  }

  /*
   * textureStretch always true, just an argument for consistency with walls
   */
  setTexture(textureUrl, textureStretch, textureScale) {
    let uuid = this.getUuid();
    this.floorplan.setFloorTexture(uuid, textureUrl, textureScale);
    this.dispatchEvent({ type: EVENT_CHANGED, item: this });
    // this.floorChangeCallbacks.fire();
  }

  generateRoofPlane() {
    if (this.roofPlane && this.roofPlane != null) {
      if (this.roofPlane.parent != null) {
        this.roofPlane.parent.remove(this.roofPlane);
      }
    }
    // setup texture
    let geometry = new Geometry();

    this.corners.forEach((corner) => {
      let vertex = new Vector3(corner.x, corner.elevation, corner.y);
      geometry.vertices.push(vertex);
    });
    for (let i = 2; i < geometry.vertices.length; i++) {
      let face = new Face3(0, i - 1, i);
      geometry.faces.push(face);
    }
    this.roofPlane = new Mesh(
      geometry,
      new MeshBasicMaterial({ side: DoubleSide, visible: false }),
    );
    this.roofPlane.room = this;
  }

  generatePlane() {
    let points = [];
    this.interiorCorners.forEach((corner) => {
      points.push(new Vector2(corner.x, corner.y));
    });
    let shape = new Shape(points);
    let geometry = new ShapeGeometry(shape);
    this.floorPlane = new Mesh(
      geometry,
      new MeshBasicMaterial({ side: DoubleSide, visible: false }),
    );
    //The below line was originally setting the plane visibility to false
    //Now its setting visibility to true. This is necessary to be detected
    //with the raycaster objects to click walls and floors.
    this.floorPlane.visible = true;
    this.floorPlane.rotation.set(Math.PI / 2, 0, 0);
    this.floorPlane.room = this; // js monkey patch

    let b3 = new Box3();
    b3.setFromObject(this.floorPlane);
    this.min = b3.min.clone();
    this.max = b3.max.clone();
    this.center = this.max
      .clone()
      .sub(this.min)
      .multiplyScalar(0.5)
      .add(this.min);
  }

  cycleIndex(index) {
    if (index < 0) {
      return (index += this.corners.length);
    } else {
      return index % this.corners.length;
    }
  }

  pointInRoom(pt) {
    let polygon = [];
    this.corners.forEach((corner) => {
      let co = new Vector2(corner.x, corner.y);
      polygon.push(co);
    });
    return Utils.pointInPolygon2(pt, polygon);
  }

  updateInteriorCorners() {
    let edge = this.edgePointer;
    let iterateWhile = true;
    while (iterateWhile) {
      this.interiorCorners.push(edge.interiorStart());
      edge.generatePlane();
      if (edge.next === this.edgePointer) {
        break;
      } else {
        edge = edge.next;
      }
    }
  }

  updateArea() {
    let oldArea = this.area;
    let points = [];
    let allPoints = [];
    this.areaCenter = new Vector2();
    this._polygonPoints = [];

    let firstCorner, secondCorner, wall, i, corner, region;

    for (i = 0; i < this.corners.length; i++) {
      corner = this.corners[i];
      firstCorner = this.corners[i];
      secondCorner = this.corners[(i + 1) % this.corners.length];
      wall = firstCorner.wallToOrFrom(secondCorner);

      if (wall != null) {
        if (wall.wallType == WallTypes.CURVED) {
          let begin = corner.location.clone().sub(wall.bezier.get(0)).length();
          let p;
          let stepIndex;
          allPoints.push(corner.location.clone());

          if (begin < 1e-6) {
            for (stepIndex = 1; stepIndex < 20; stepIndex++) {
              p = wall.bezier.get(stepIndex / 20);
              allPoints.push(new Vector2(p.x, p.y));
            }
          } else {
            for (stepIndex = 19; stepIndex > 0; stepIndex--) {
              p = wall.bezier.get(stepIndex / 20);
              allPoints.push(new Vector2(p.x, p.y));
            }
          }
        } else {
          allPoints.push(corner.location.clone());
        }
      } else {
        allPoints.push(corner.location.clone());
      }
    }

    points = allPoints;
    region = new Region(points);
    this.area = Math.abs(region.area());
    this.areaCenter = region.centroid();
    this._polygonPoints = points;
    this.dispatchEvent({
      type: EVENT_ROOM_ATTRIBUTES_CHANGED,
      item: this,
      info: { from: oldArea, to: this.area },
    });
  }

  updateArea2() {
    let scope = this;
    let isComplexRoom = false;
    let oldArea = this.area;
    let points = [];
    let N = 0;
    let area = 0;
    this.areaCenter = new Vector2();
    this._polygonPoints = [];

    //The below makes this routine too slow
    // this.updateWalls();
    // this.updateInteriorCorners();
    // this.generatePlane();
    // this.generateRoofPlane();

    for (let i = 0; i < this.corners.length; i++) {
      let firstCorner = this.corners[i];
      let secondCorner = this.corners[(i + 1) % this.corners.length];
      let wall = firstCorner.wallToOrFrom(secondCorner);
      isComplexRoom |= wall.wallType == WallTypes.CURVED;
    }

    let inext, a, b, ax_by, ay_bx, delta;
    if (!isComplexRoom) {
      this.corners.forEach((corner) => {
        let co = new Vector2(corner.x, corner.y);
        scope.areaCenter.add(co);
        points.push(co);
      });
      this.areaCenter.multiplyScalar(1.0 / points.length);
      for (i = 0; i < points.length; i++) {
        inext = (i + 1) % points.length;
        a = points[i];
        b = points[inext];
        ax_by = a.x * b.y;
        ay_bx = a.y * b.x;
        delta = ax_by - ay_bx;
        area += delta;
      }
      this.area = Math.abs(area) * 0.5;
      this._polygonPoints = points;
      this.dispatchEvent({
        type: EVENT_ROOM_ATTRIBUTES_CHANGED,
        item: this,
        info: { from: oldArea, to: this.area },
      });
      return;
    }

    // this.corners.forEach((corner) => {
    // let co = new Vector2(corner.x,corner.y);
    // this.areaCenter.add(co);
    // points.push(co);
    // });

    N = this.corners.length;

    for (i = 0; i < this.corners.length; i++) {
      firstCorner = this.corners[i];
      secondCorner = this.corners[(i + 1) % this.corners.length];
      wall = firstCorner.wallToOrFrom(secondCorner);
      this.areaCenter.add(firstCorner.location);

      if (wall != null) {
        if (wall.wallType == WallTypes.CURVED) {
          points.push(firstCorner.location);
          let LUT = wall.bezier.getLUT(20);
          for (let j = 1; j < LUT.length - 1; j++) {
            let p = LUT[j];
            p = new Vector2(p.x, p.y);
            points.push(p);
          }
        } else {
          points.push(firstCorner.location);
        }
      } else {
        points.push(firstCorner.location);
      }
    }

    this.areaCenter.multiplyScalar(1.0 / N);

    let indicesAndAngles = Utils.getCyclicOrder(points, this.areaCenter);
    points = indicesAndAngles['points'];

    for (i = 0; i < points.length; i++) {
      inext = (i + 1) % points.length;
      a = points[i];
      b = points[inext];
      //Another irregular polygon method based on the url below
      //https://www.mathsisfun.com/geometry/area-irregular-polygons.html
      // let width = a.x - b.x;
      // let height = (a.y + b.y) * 0.5;
      // let delta = Math.abs(width * height);
      ax_by = a.x * b.y;
      ay_bx = a.y * b.x;
      delta = ax_by - ay_bx;
      area += delta;
    }
    this._polygonPoints = points;
    this.area = Math.abs(area) * 0.5;
    // if we are using the method in url https://www.mathsisfun.com/geometry/area-irregular-polygons.html
    // then we dont have to multiply the area by 0.5;
    // this.area = Math.abs(area);
    this.dispatchEvent({
      type: EVENT_ROOM_ATTRIBUTES_CHANGED,
      item: this,
      info: { from: oldArea, to: this.area },
    });
  }

  hasAllCornersById(ids) {
    let sum = 0;
    for (let i = 0; i < ids.length; i++) {
      sum += this.hasACornerById(ids[i]);
    }
    return sum == this.corners.length;
  }

  hasACornerById(id) {
    for (let i = 0; i < this.corners.length; i++) {
      let corner = this.corners[i];
      if (corner.id == id) {
        return 1;
      }
    }
    return 0;
  }

  /*
   * Populates each wall's half edge relating to this room
   * this creates a fancy doubly connected edge list (DCEL)
   */
  updateWalls() {
    let prevEdge = null;
    let firstEdge = null;

    for (let i = 0; i < this.corners.length; i++) {
      let firstCorner = this.corners[i];
      let secondCorner = this.corners[(i + 1) % this.corners.length];

      // find if wall is heading in that direction
      let wallTo = firstCorner.wallTo(secondCorner);
      let wallFrom = firstCorner.wallFrom(secondCorner);
      let edge = null;
      if (wallTo) {
        edge = new HalfEdge(this, wallTo, true);
      } else if (wallFrom) {
        edge = new HalfEdge(this, wallFrom, false);
      } else {
        // something horrible has happened
        // console.log(
        //   'room_updateWalls: ',
        //   "corners aren't connected by a wall, uh oh",
        // );
      }

      if (i == 0) {
        firstEdge = edge;
      } else {
        edge.prev = prevEdge;
        prevEdge.next = edge;
        if (i + 1 == this.corners.length) {
          firstEdge.prev = edge;
          edge.next = firstEdge;
        }
      }
      prevEdge = edge;
    }

    // hold on to an edge reference
    this.edgePointer = firstEdge;
  }
}
