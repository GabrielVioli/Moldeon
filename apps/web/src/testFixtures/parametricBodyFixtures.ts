import type { BodyMeasurements, BodyType } from "../domain/pattern";
import {
  createMeasurementProfile,
  type MeasurementProfile,
} from "../domain/parametricMeasurements";

export type ParametricBodyFixtureId =
  | "small"
  | "medium"
  | "large"
  | "tall-narrow"
  | "short-wide";

export interface ParametricBodyFixture {
  id: ParametricBodyFixtureId;
  bodyType: BodyType;
  supplied: BodyMeasurements;
  profile: MeasurementProfile;
}

const FIXTURE_INPUTS: Record<ParametricBodyFixtureId, { bodyType: BodyType; supplied: BodyMeasurements }> = {
  small: {
    bodyType: "feminine",
    supplied: base(1540, 780, 620, 840),
  },
  medium: {
    bodyType: "feminine",
    supplied: base(1680, 920, 760, 1000),
  },
  large: {
    bodyType: "masculine",
    supplied: base(1830, 1260, 1120, 1240),
  },
  "tall-narrow": {
    bodyType: "masculine",
    supplied: base(1980, 900, 760, 920),
  },
  "short-wide": {
    bodyType: "feminine",
    supplied: base(1480, 1180, 1040, 1320),
  },
};

export function createParametricBodyFixture(id: ParametricBodyFixtureId): ParametricBodyFixture {
  const fixture = FIXTURE_INPUTS[id];
  return {
    id,
    bodyType: fixture.bodyType,
    supplied: structuredClone(fixture.supplied),
    profile: createMeasurementProfile(fixture.supplied, fixture.bodyType),
  };
}

export function createAllParametricBodyFixtures(): ParametricBodyFixture[] {
  return (Object.keys(FIXTURE_INPUTS) as ParametricBodyFixtureId[]).map(createParametricBodyFixture);
}

function base(heightMm: number, bustMm: number, waistMm: number, hipMm: number): BodyMeasurements {
  return {
    heightMm,
    bustMm,
    waistMm,
    hipMm,
    shoulderWidthMm: heightMm * 0.24,
    torsoLengthMm: heightMm * 0.262,
    armLengthMm: heightMm * 0.35,
    inseamMm: heightMm * 0.465,
  };
}
