import React, { useEffect } from 'react';
import * as Blueprint from '../../utils/blueprint/blueprint';
import useZustand from '../../utils/useZustand';
import { loadDefaultDesign } from '../../utils/bpSupport';
import cn from 'classnames';

const Scene_Content = () => {
  const editMode = useZustand((state) => state.editMode);
  const setSelectedWall = useZustand((state) => state.setSelectedWall);
  const setSelectedFloor = useZustand((state) => state.setSelectedFloor);
  const setFloorPlanMode = useZustand((state) => state.setFloorPlanMode);
  const setCur2dItemEvent = useZustand((state) => state.setCur2dItemEvent);
  const setCur3dItemEvent = useZustand((state) => state.setCur3dItemEvent);

  useEffect(() => {
    // init
    window.blueprintJS = new Blueprint.BlueprintJS({
      floorplannerElement: 'floor_planner',
      threeElement: 'three',
      threeCanvasElement: 'three-canvas',
      widget: false,
    });
    console.log('blueprintJS: ', blueprintJS);

    // load home
    loadDefaultDesign();

    // init events
    initEvents();
  }, []);

  const initEvents = () => {
    /* three */
    // blueprintJS.three.addEventListener(Blueprint.EVENT_FPS_EXIT, (o) => {
    //   console.log('EVENT_FPS_EXIT: ', o);
    // });

    // blueprintJS.three.addEventListener(Blueprint.EVENT_GLTF_READY, (o) => {
    //   console.log('EVENT_GLTF_READY: ', o);
    // });

    blueprintJS.three.addEventListener(Blueprint.EVENT_ITEM_SELECTED, (o) => {
      console.log('EVENT_ITEM_SELECTED: ', o);
      setCur3dItemEvent(o);
    });

    blueprintJS.three.addEventListener(Blueprint.EVENT_ITEM_UNSELECTED, (o) => {
      console.log('EVENT_ITEM_UNSELECTED: ', o);
      setCur3dItemEvent(null);
    });

    blueprintJS.three.addEventListener(Blueprint.EVENT_WALL_CLICKED, (o) => {
      console.log('EVENT_WALL_CLICKED: ', o);
      setSelectedWall(o);
    });

    blueprintJS.three.addEventListener(Blueprint.EVENT_FLOOR_CLICKED, (o) => {
      console.log('EVENT_FLOOR_CLICKED: ', o);
      setSelectedFloor(o);
    });

    blueprintJS.three.addEventListener(Blueprint.EVENT_NOTHING_CLICKED, (o) => {
      console.log('EVENT_NOTHING_CLICKED: ', o);
      setSelectedWall(null);
      setSelectedFloor(null);
    });

    // blueprintJS.three.addEventListener(
    //   Blueprint.EVENT_CAMERA_VIEW_CHANGE,
    //   (o) => {
    //     console.log('EVENT_CAMERA_VIEW_CHANGE: ', o);
    //   },
    // );

    // blueprintJS.three.addEventListener(
    //   Blueprint.EVENT_CAMERA_ACTIVE_STATUS,
    //   (o) => {
    //     console.log('EVENT_CAMERA_ACTIVE_STATUS: ', o);
    //   },
    // );

    /* floor planner */
    // When the planner mode changes. (between move, draw and delete)
    blueprintJS.floorplanner.addEventListener(
      Blueprint.EVENT_MODE_RESET,
      (o) => {
        console.log('EVENT_MODE_RESET: ', o);
        setFloorPlanMode(o.mode);
      },
    );

    // global events
    blueprintJS.floorplanner.floorplan.addEventListener(
      Blueprint.EVENT_NOTHING_CLICKED,
      (o) => {
        console.log('EVENT_NOTHING_CLICKED: ', o);
        setCur2dItemEvent(null);
      },
    );

    // corner events
    blueprintJS.floorplanner.floorplan.addEventListener(
      Blueprint.EVENT_CORNER_2D_CLICKED,
      (o) => {
        console.log('EVENT_CORNER_2D_CLICKED: ', o);
        o.type = 'CORNER';
        setCur2dItemEvent(o);
      },
    );

    blueprintJS.floorplanner.floorplan.addEventListener(
      Blueprint.EVENT_CORNER_2D_MOVED,
      (o) => {
        console.log('EVENT_CORNER_2D_MOVED: ', o);
        o.type = 'CORNER';
        setCur2dItemEvent(o);
      },
    );

    // wall events
    blueprintJS.floorplanner.floorplan.addEventListener(
      Blueprint.EVENT_WALL_2D_CLICKED,
      (o) => {
        console.log('EVENT_WALL_2D_CLICKED: ', o);
        o.type = 'WALL';
        setCur2dItemEvent(o);
      },
    );

    // room events
    blueprintJS.floorplanner.floorplan.addEventListener(
      Blueprint.EVENT_ROOM_2D_CLICKED,
      (o) => {
        console.log('EVENT_ROOM_2D_CLICKED: ', o);
        o.type = 'ROOM';
        setCur2dItemEvent(o);
      },
    );
  };

  return (
    <div className="Scene_Content">
      <canvas
        id="floor_planner"
        className={cn({ hide: editMode !== 'FLOOR PLAN' })}></canvas>
      <div id="three" className={cn({ hide: editMode !== '3D' })}></div>
    </div>
  );
};

export default Scene_Content;