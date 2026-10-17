import { apiListenPort } from './ports';

describe('apiListenPort', () => {
  it('uses PORT, then MC_API_PORT, then 3000', () => {
    expect(apiListenPort({ PORT: '3405', MC_API_PORT: '3880' })).toBe(3405);
    expect(apiListenPort({ MC_API_PORT: '3880' })).toBe(3880);
    expect(apiListenPort({ PORT: '   ', MC_API_PORT: '3880' })).toBe(3880);
    expect(apiListenPort({})).toBe(3000);
  });

  it('rejects a PORT that is not a port number', () => {
    expect(() => apiListenPort({ PORT: 'nope', MC_API_PORT: '3880' })).toThrow(
      /PORT is not a valid port number/,
    );
  });
});
