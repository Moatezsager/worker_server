import { Rates, HistoryPoint } from './types';

// Only source observations or persisted prices may enter the Worker state.
export let rates: Rates = {
  official: {}, parallel: {}, previousOfficial: {}, previousParallel: {},
  lastUpdated: '', lastChanged: { official: {}, parallel: {} }
};
export let history: HistoryPoint[] = [];
export const serverStartTime = new Date();


