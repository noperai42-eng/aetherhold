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

  /**
   * One node the whole valley hangs from, and the only thing a pocket scene is
   * allowed to switch off.
   *
   * The first version of `setVisible` wrote the ten subsystem groups' own
   * `.visible` flags directly, and two of those flags already had an owner:
   * `DecorView.setDecor` and `WeatherView.applyQuality` set them from the
   * quality preset. Turning the valley back on therefore *overwrote* the
   * preset — a player on Low who stepped into the hollow once came back to
   * decor that was visible but whose `enabled` was still false, so it rendered
   * and never rebuilt again: 1.6 M triangles of grass standing inside walls and
   * on plowed farm plots, on the machine that had explicitly asked for less.
   * Nothing healed it but cycling the quality button.
   *
   * A parent has no such owner. Hiding it hides everything underneath without
   * touching a flag any subsystem is keeping for itself, so the two questions —
   * "is the valley on screen" and "does this machine draw grass" — stop sharing
   * a variable.
   */
  private readonly root = new THREE.Group();

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

    this.root.add(
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
    this.scene.add(this.root);
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
    dt: number,
  ): void {
    this.terrain.sync(world);
    this.decor.sync(world, world.tick + alpha);
    this.buildings.sync(world);
    this.landmarks.sync(world, world.tick + alpha);
    this.pawns.sync(world, alpha, hiddenPawnId, dt);
    this.pickies.sync(world, alpha);
    this.sky.sync(world, focus.x, focus.y);
    this.fx.sync(world, world.tick + alpha, alpha);
    this.weather.sync(world, world.tick + alpha, focus);

    // Fog is the whole of the fog weather: pulling the far plane in to a couple of
    // dozen cells is what makes a raid emerge out of nowhere instead of being
    // spotted from the far wall.
    const fog = this.scene.fog as THREE.Fog;
    this.sky.applyFog(fog, world);

    // The haze over unwalked ground takes its colour from the same sky, so the
    // edge of the map and the edge of the weather are the same kind of thing.
    // After the fog, because it reads the colour the fog just settled on.
    this.shroud.sync(world);
    this.shroud.setTint(fog.color);
  }

  /** Hide the valley while a pocket scene has the renderer. */
  setVisible(on: boolean): void {
    this.root.visible = on;
  }

  applyQuality(settings: QualitySettings): void {
    this.sky.applyQuality(settings);
    this.fx.setDecor(settings.decor);
    this.decor.setDecor(settings.decor);
    this.weather.applyQuality(settings);
  }

  dispose(): void {
    this.scene.remove(this.root);
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
