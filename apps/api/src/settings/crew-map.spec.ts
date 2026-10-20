import { assignCrewSeats, readCrew } from './naming';
import { mergeNamedCrewMap, syncCrewSeats, type CrewMapDb } from './crew-map';

/**
 * Crew seats follow agent id. A saved map does not move when the
 * roster grows, shrinks, or changes position.
 */

const seats = [
  { id: 'speedy' },
  { id: 'atlas' },
  { id: 'pixel' },
  { id: 'quill' },
];

describe('assignCrewSeats', () => {
  it('gives pixel and quill their own seats and ignores display order', () => {
    const map = assignCrewSeats(
      [
        { id: 'quill', position: 0 },
        { id: 'pixel', position: 4 },
        { id: 'helper', position: 1 },
      ],
      seats,
    );
    expect(map).toEqual({
      pixel: 'pixel',
      quill: 'quill',
      helper: 'speedy',
    });
  });

  it('keeps a free seat when another agent arrives and when one is removed', () => {
    const first = assignCrewSeats([{ id: 'helper', position: 0 }], seats);
    expect(first).toEqual({ helper: 'speedy' });

    const arrived = assignCrewSeats(
      [
        { id: 'helper', position: 0 },
        { id: 'nova', position: 1 },
      ],
      seats,
      first,
      new Set(['helper']),
    );
    expect(arrived).toEqual({ helper: 'speedy', nova: 'atlas' });

    const removed = assignCrewSeats(
      [{ id: 'nova', position: 9 }],
      seats,
      arrived,
      new Set(['nova']),
    );
    expect(removed).toEqual({ nova: 'atlas' });
  });

  it('does not move seats when positions change', () => {
    const saved = { helper: 'atlas', pixel: 'pixel' };
    const map = assignCrewSeats(
      [
        { id: 'pixel', position: 0 },
        { id: 'helper', position: 8 },
      ],
      seats,
      saved,
      new Set(['helper', 'pixel']),
    );
    expect(map).toEqual(saved);
  });

  it('does not give a taken seat to a later agent with that id', () => {
    const map = assignCrewSeats(
      [
        { id: 'early', position: 0 },
        { id: 'pixel', position: 1 },
      ],
      seats,
      { early: 'pixel' },
    );
    expect(map.early).toBe('pixel');
    expect(map.pixel).toBe('speedy');
  });

  it('a manual seat wins over an id match', () => {
    const map = assignCrewSeats(
      [
        { id: 'pixel', position: 0 },
        { id: 'helper', position: 1 },
      ],
      seats,
      { pixel: 'quill' },
      new Set(['pixel']),
    );
    expect(map.pixel).toBe('quill');
    expect(map.helper).toBe('speedy');
  });

  it('uses the shipped crew file for real seat ids', () => {
    const crew = readCrew();
    const map = assignCrewSeats(
      [
        { id: 'helper', position: 0 },
        { id: 'pixel', position: 2 },
        { id: 'quill', position: 1 },
      ],
      crew,
    );
    expect(map.pixel).toBe('pixel');
    expect(map.quill).toBe('quill');
    expect(map.helper).toBe('speedy');
    expect(crew.find((seat) => seat.id === 'pixel')?.name).toBe('Pixel');
    expect(crew.find((seat) => seat.id === 'quill')?.name).toBe('Quill');
  });
});

describe('syncCrewSeats', () => {
  function db(agents: { id: string; position: number }[]) {
    const rows = new Map(agents.map((agent) => [agent.id, { ...agent }]));
    const state: {
      namingMode: string | null;
      crewMap: Record<string, string>;
    } = { namingMode: 'crew', crewMap: {} };
    const prisma: CrewMapDb = {
      agent: {
        findMany: () => Promise.resolve([...rows.values()]),
      },
      setting: {
        findUnique: () => Promise.resolve(state),
        update: ({ data }) => {
          state.crewMap = data.crewMap;
          return Promise.resolve(state);
        },
      },
    };
    return { rows, state, prisma };
  }

  it('saves a free seat and keeps it after another arrival', async () => {
    const { rows, state, prisma } = db([{ id: 'helper', position: 0 }]);
    expect(await syncCrewSeats(prisma, { arrived: ['helper'] })).toBe(true);
    expect(state.crewMap).toEqual({ helper: 'speedy' });

    const saved = { ...state.crewMap };
    expect(await syncCrewSeats(prisma, {})).toBe(false);
    expect(state.crewMap).toEqual(saved);

    rows.set('nova', { id: 'nova', position: 1 });
    expect(await syncCrewSeats(prisma, { arrived: ['nova'] })).toBe(true);
    expect(state.crewMap.helper).toBe('speedy');
    expect(state.crewMap.nova).toBe('atlas');
  });

  it('drops a removed agent without shifting the rest', async () => {
    const { rows, state, prisma } = db([
      { id: 'helper', position: 0 },
      { id: 'pixel', position: 1 },
      { id: 'quill', position: 2 },
    ]);
    await syncCrewSeats(prisma, { arrived: ['helper', 'pixel', 'quill'] });
    expect(state.crewMap).toEqual({
      pixel: 'pixel',
      quill: 'quill',
      helper: 'speedy',
    });

    rows.delete('helper');
    await syncCrewSeats(prisma, { removed: ['helper'] });
    expect(state.crewMap).toEqual({ pixel: 'pixel', quill: 'quill' });

    rows.get('pixel')!.position = 20;
    rows.get('quill')!.position = 0;
    expect(await syncCrewSeats(prisma, {})).toBe(false);
    expect(state.crewMap).toEqual({ pixel: 'pixel', quill: 'quill' });
  });

  it('leaves own names mode alone and keeps a manual seat', async () => {
    const { state, prisma, rows } = db([{ id: 'pixel', position: 0 }]);
    state.namingMode = 'own';
    state.crewMap = { pixel: 'speedy' };
    expect(await syncCrewSeats(prisma, { arrived: ['pixel'] })).toBe(false);
    expect(state.crewMap).toEqual({ pixel: 'speedy' });

    state.namingMode = 'crew';
    state.crewMap = { pixel: 'forge' };
    rows.set('helper', { id: 'helper', position: 3 });
    await syncCrewSeats(prisma, { arrived: ['helper'] });
    expect(state.crewMap.pixel).toBe('forge');
    expect(state.crewMap.helper).toBe('speedy');
  });

  it('gives a living agent missing from the map the next free seat', async () => {
    const { state, prisma } = db([{ id: 'helper', position: 3 }]);
    state.crewMap = {};
    expect(await syncCrewSeats(prisma, {})).toBe(true);
    expect(state.crewMap).toEqual({ helper: 'speedy' });
  });

  it('keeps Own name through sync and does not give it a freed seat', async () => {
    const { rows, state, prisma } = db([
      { id: 'quill', position: 0 },
      { id: 'pixel', position: 1 },
      { id: 'waiter', position: 2 },
    ]);
    state.crewMap = { quill: '', pixel: 'pixel' };
    expect(await syncCrewSeats(prisma, {})).toBe(true);
    expect(state.crewMap.quill).toBe('');
    expect(state.crewMap.pixel).toBe('pixel');
    expect(state.crewMap.waiter).toBe('speedy');

    rows.delete('pixel');
    expect(await syncCrewSeats(prisma, { removed: ['pixel'] })).toBe(true);
    expect(state.crewMap.quill).toBe('');
    expect(state.crewMap.pixel).toBeUndefined();
    expect(state.crewMap.waiter).toBe('speedy');
  });
});

describe('mergeNamedCrewMap', () => {
  const agents = [
    { id: 'helper', position: 0 },
    { id: 'pixel', position: 1 },
    { id: 'nova', position: 2 },
    { id: 'newcomer', position: 3 },
    { id: 'quill', position: 4 },
  ];

  it('leaves out a newer agent and keeps that seat', () => {
    const wider = [...seats, { id: 'sentinel' }, { id: 'forge' }];
    const stored = {
      helper: 'speedy',
      pixel: 'pixel',
      quill: 'quill',
      newcomer: 'sentinel',
    };
    const next = mergeNamedCrewMap(agents, wider, stored, {
      helper: 'speedy',
      pixel: 'forge',
      quill: 'quill',
    });
    expect(next.newcomer).toBe('sentinel');
    expect(next.pixel).toBe('forge');
    expect(next.helper).toBe('speedy');
    expect(next.quill).toBe('quill');
  });

  it('gives a freed seat to the earliest agent with no saved choice', () => {
    const next = mergeNamedCrewMap(
      agents,
      seats,
      { pixel: 'pixel', quill: '' },
      {
        pixel: '',
      },
    );
    expect(next.quill).toBe('');
    expect(next.pixel).toBe('');
    expect(next.helper).toBe('pixel');
    expect(next.nova).toBeUndefined();
  });

  it('reseats a holder who lost a seat, unless that holder is set to Own name', () => {
    const taken = mergeNamedCrewMap(
      agents,
      seats,
      { helper: 'speedy', pixel: 'pixel' },
      { pixel: 'speedy' },
    );
    expect(taken.pixel).toBe('speedy');
    expect(taken.helper).toBe('pixel');

    const own = mergeNamedCrewMap(
      agents,
      seats,
      { helper: 'speedy', pixel: 'pixel' },
      { pixel: 'speedy', helper: '' },
    );
    expect(own.pixel).toBe('speedy');
    expect(own.helper).toBe('');
    expect(own.nova).toBe('pixel');
  });
});
