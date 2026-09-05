/**
 * The single visual representation of the world. Both cameras draw this and only
 * this: there is no second scene, no FPS-only geometry and no manager-only solid.
 * Whatever you can see here, the simulation agrees is there.
 */

import * as THREE from 'three';

import { BuildingsView } from './buildings';
import { DecorView } from './decor';
import { FxView } from './fx';
import { LandmarkView } from './landmarks';
import { PawnsView } from './pawns';
import { PickiesView } from './pickies';
import { ShroudView } from './shroud';
import { SkyView } from './sky';
import { TerrainView } from './terrain';
import { WeatherView } from './weather-view';
import type { QualitySettings, Viewport } from './renderer';
import type { World } from '../../sim/types';

export class WorldView {
  readonly terrain: TerrainView;
  readonly decor: DecorView;
  readonly buildings: BuildingsView;
  readonly landmarks: LandmarkView;
  readonly pawns: PawnsView;
  readonly pickies: PickiesView;
  readonly shroud: ShroudView;
  readonly sky: SkyView;
  readonly fx: FxView;
  readonly weather: WeatherView;
  private readonly scene: THREE.Scene;

  constructor(viewport: Viewport, world: World) {
    this.scene = viewport.scene;
    this.terrain = new TerrainView(world);
    this.decor = new DecorView(world);
    this.buildings = new BuildingsView();
    this.landmarks = new LandmarkView(world);
    this.pawns = new PawnsView();
    this.pickies = new PickiesView();
    this.shroud = new ShroudView(world);
    this.sky = new SkyView(world, viewport.config);
    this.fx = new FxView();
    this.weather = new WeatherView();
    this.fx.setDecor(viewport.config.decor);
    this.decor.setDecor(viewport.config.decor);
    this.weather.applyQuality(viewport.config);

    this.scene.add(
      this.terrain.group,
      this.decor.group,
      this.buildings.group,
      this.landmarks.group,
      this.pawns.group,
      this.pickies.group,
      this.shroud.group,
      this.sky.group,
      this.fx.group,
      this.weather.group,
    );
  }

  /** Call immediately after every simulation step so interpolation has two frames. */
  onTick(world: World): void {
    this.pawns.onTick(world);
    this.pickies.onTick(world);
  }

  /**
   * `focus` is where the player's attention is (camera target, or the possessed
   * body): the sun's shadow frustum and the sky dome follow it.
   */
  sync(
    world: World,
    alpha: number,
    focus: { x: number; y: number },
    hiddenPawnId: number | null,
  ): void {
    this.terrain.sync(world);
    this.decor.sync(world, world.tick + alpha);
    this.buildings.sync(world);
    this.landmarks.sync(world, world.tick + alpha);
    this.pawns.sync(world, alpha, hiddenPawnId);
    this.pickies.sync(world, alpha);
    this.sky.sync(world, focus.x, focus.y);
    this.fx.sync(world, world.tick + alpha, alpha);
    this.weather.sync(world, world.tick + alpha, focus);

    // Fog is the whole of the fog weather: pulling the far plane in to a couple of
    // dozen cells is what makes a raid emerge out of nowhere instead of being
    // spotted from the far wall.
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.sky.fogColor());
    const range = this.sky.fogRange(world);
    fog.near = range.near;
    fog.far = range.far;

    // The haze over unwalked ground takes its colour from the same sky, so the
    // edge of the map and the edge of the weather are the same kind of thing.
    // After the fog, because it reads the colour the fog just settled on.
    this.shroud.sync(world);
    this.shroud.setTint(fog.color);
  }

  /** Hide the valley while a pocket scene has the renderer. */
  setVisible(on: boolean): void {
    this.terrain.group.visible = on;
    this.decor.group.visible = on;
    this.buildings.group.visible = on;
    this.landmarks.group.visible = on;
    this.pawns.group.visible = on;
    this.pickies.group.visible = on;
    this.shroud.group.visible = on;
    this.sky.group.visible = on;
    this.fx.group.visible = on;
    this.weather.group.visible = on;
  }

  applyQuality(settings: QualitySettings): void {
    this.sky.applyQuality(settings);
    this.fx.setDecor(settings.decor);
    this.decor.setDecor(settings.decor);
    this.weather.applyQuality(settings);
  }

  dispose(): void {
    this.scene.remove(
      this.terrain.group,
      this.decor.group,
      this.buildings.group,
      this.landmarks.group,
      this.pawns.group,
      this.pickies.group,
      this.shroud.group,
      this.sky.group,
      this.fx.group,
      this.weather.group,
    );
    this.terrain.dispose();
    this.decor.dispose();
    this.buildings.dispose();
    this.landmarks.dispose();
    this.pawns.dispose();
    this.pickies.dispose();
    this.shroud.dispose();
    this.sky.dispose();
    this.fx.dispose();
    this.weather.dispose();
  }
}
