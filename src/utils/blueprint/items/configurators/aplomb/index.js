import { itemLayerHeight } from '../../../../../constants';
import { Factory } from '../../factory';
import { Root } from './root';

export class Aplomb {
  constructor(info) {
    Object.setPrototypeOf(
      this,
      new (Factory.getClass(info.metadata.type))(info),
    );
    this.scene = info.model.scene.scene;
    this.root = new Root(this);
    this.add(this.root);
    this.root.position.y = itemLayerHeight;
  }

  redrawComponents() {
    this.root.redrawComponents(this.metadata.components);
  }

  getPrice() {
    return 0;
  }
}
