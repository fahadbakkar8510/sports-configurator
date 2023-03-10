import { Group, PlaneGeometry } from 'three';
import { Plane } from './plane';
import { Net } from './net';
import { Dimensioning } from '../../../core/dimensioning';

export class Root extends Group {
  constructor(item) {
    super();
    if (!item.metadata) item.metadata.unit = 'm';
    this.item = item;
    this.scene = item.model.scene.scene;
    this.unit = item.metadata.unit;
    this.maxSize = item.metadata.max_size;

    const dimensionInfo = this.getDimensionInfo(item.metadata.components);
    this.redrawItem(dimensionInfo);

    this.plane = new Plane({
      item,
      compInfo: dimensionInfo,
    });
    this.add(this.plane);

    this.net = new Net({ item, compInfo: dimensionInfo });
    this.add(this.net);
  }

  getDimensionInfo(components) {
    // calculate dimension size.
    const width = Dimensioning.cmFromMeasureRaw(
      components.width.value,
      this.unit,
    );
    const height = Dimensioning.cmFromMeasureRaw(
      components.height.value,
      this.unit,
    );
    return { width, height };
  }

  redrawItem({ width, height }) {
    this.item.geometry = new PlaneGeometry(width, height);
    this.item.position.y = height / 2;
    this.item.refreshItem();
  }

  redrawComponents(components) {
    const dimensionInfo = this.getDimensionInfo(components);
    this.redrawItem(dimensionInfo);

    this.plane.redrawComponents({
      components,
      compInfo: dimensionInfo,
    });

    this.net.redrawComponents({ components, compInfo: dimensionInfo });
  }
}
