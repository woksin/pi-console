import { timelineGroups as repositoryGroups, type TimelineLane } from '@pi-console/viewmodels';

export { withoutRepositoryPrefix } from '@pi-console/viewmodels';

export const laneHeight = 34;
export const groupHeight = 28;

/** Web-only layout: repository headers and contiguous lanes; shared timeline data stays unchanged. */
export function timelineGroups(lanes: readonly TimelineLane[], sessions: readonly { id: string; repositoryId: string }[]) {
  let top = 30;
  return repositoryGroups(lanes, sessions).map(group => {
    const layout = { ...group, top };
    top += groupHeight + group.lanes.length * laneHeight;
    return layout;
  });
}

const minLabelWidth = 170;
const maxLabelWidth = 340;
const cellPixels = 8;
const labelChrome = 32;

/** Label column in viewBox units: wide enough for the longest lane label, within bounds, so the lane id is never the part that is cut. */
export function labelColumnWidth(fullLabelWidths: readonly number[]): number {
  const widest = Math.max(0, ...fullLabelWidths);
  return Math.min(maxLabelWidth, Math.max(minLabelWidth, labelChrome + widest * cellPixels));
}

export const labelCellsFor = (labelWidth: number): number => Math.floor((labelWidth - labelChrome) / cellPixels);
