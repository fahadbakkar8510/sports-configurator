import {
  EventDispatcher,
  HemisphereLight,
  DirectionalLight,
  AmbientLight,
  Vector3,
} from 'three';
import { EVENT_UPDATED } from '../core/events.js';

export class Lights extends EventDispatcher {
  constructor(scene, floorplan) {
    super();
    this.scene = scene;
    this.floorplan = floorplan;
    this.tol = 1;
    this.height = 300; // TODO: share with Blueprint.Wall
    this.dirLight = null;
    this.updatedRoomsEvent = () => {
      this.updateShadowCamera();
    };
    this.init();
  }

  getDirLight() {
    return this.dirLight;
  }

  init() {
    let hemLight = new HemisphereLight(0xffffff, 0x888888, 1.1);
    hemLight.position.set(0, this.height, 0);
    this.scene.add(hemLight);

    // let ambLight = new AmbientLight(0xffffff, 0x888888, 1.1);
    // ambLight.position.set(0, this.height, 0);
    // this.scene.add(ambLight);

    this.dirLight = new DirectionalLight(0xffffff, 0.5);
    this.dirLight.color.setHSL(1, 1, 0.1);

    this.dirLight.castShadow = true;

    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;

    this.dirLight.shadow.camera.far = this.height + this.tol;
    this.dirLight.shadow.bias = -0.0001;
    this.dirLight.shadowDarkness = 0.2;
    this.dirLight.visible = true;
    this.dirLight.shadowCameraVisible = false;

    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.floorplan.fireOnUpdatedRooms(this.updateShadowCamera);
    this.floorplan.addEventListener(EVENT_UPDATED, this.updatedRoomsEvent);
  }

  updateShadowCamera() {
    let size = this.floorplan.getSize();
    let d = (Math.max(size.z, size.x) + this.tol) / 2.0;
    let center = this.floorplan.getCenter();
    let pos = new Vector3(center.x, this.height, center.z);
    this.dirLight.position.copy(pos);
    this.dirLight.target.position.copy(center);
    this.dirLight.updateMatrix();
    this.dirLight.updateWorldMatrix();
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    // this is necessary for updates
    if (this.dirLight.shadowCamera) {
      this.dirLight.shadow.camera.left = this.dirLight.shadowCameraLeft;
      this.dirLight.shadow.camera.right = this.dirLight.shadowCameraRight;
      this.dirLight.shadow.camera.top = this.dirLight.shadowCameraTop;
      this.dirLight.shadow.camera.bottom = this.dirLight.shadowCameraBottom;
      this.dirLight.shadowCamera.updateProjectionMatrix();
    }
  }
}
