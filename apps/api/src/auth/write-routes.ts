import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { INestApplication } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';

const WRITE_METHODS = new Set<number>([
  RequestMethod.POST,
  RequestMethod.PUT,
  RequestMethod.PATCH,
  RequestMethod.DELETE,
  RequestMethod.ALL,
]);

const METHOD_NAME: Record<number, string> = {
  [RequestMethod.POST]: 'POST',
  [RequestMethod.PUT]: 'PUT',
  [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.DELETE]: 'DELETE',
  [RequestMethod.ALL]: 'ALL',
};

export interface RegisteredWriteRoute {
  method: string;
  path: string;
}

/**
 * Every write route Nest registered on this app, from controller metadata.
 * The coverage test hits this list, so a new mutating handler is included
 * as soon as its controller is registered.
 */
export function listRegisteredWriteRoutes(
  app: INestApplication,
): RegisteredWriteRoute[] {
  const modules = app.get(ModulesContainer);
  const seen = new Set<string>();
  const routes: RegisteredWriteRoute[] = [];
  for (const mod of modules.values()) {
    for (const wrapper of mod.controllers.values()) {
      const ctor = wrapper.metatype;
      if (!ctor) continue;
      const controllerPath = Reflect.getMetadata(PATH_METADATA, ctor) as
        | string
        | string[]
        | undefined;
      const proto = ctor.prototype as Record<string, unknown>;
      for (const key of Object.getOwnPropertyNames(proto)) {
        const handler = proto[key];
        if (typeof handler !== 'function') continue;
        const methodMeta = Reflect.getMetadata(METHOD_METADATA, handler) as
          | number
          | undefined;
        const pathMeta = Reflect.getMetadata(PATH_METADATA, handler) as
          | string
          | string[]
          | undefined;
        if (methodMeta === undefined || pathMeta === undefined) continue;
        if (!WRITE_METHODS.has(methodMeta)) continue;
        const paths = Array.isArray(pathMeta) ? pathMeta : [pathMeta];
        for (const path of paths) {
          const full = joinRoute(controllerPath, path);
          const method = METHOD_NAME[methodMeta] ?? String(methodMeta);
          const id = `${method} ${full}`;
          if (seen.has(id)) continue;
          seen.add(id);
          routes.push({ method, path: full });
        }
      }
    }
  }
  routes.sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  return routes;
}

export function joinRoute(
  controllerPath: string | string[] | undefined,
  methodPath: string,
): string {
  const prefix = Array.isArray(controllerPath)
    ? (controllerPath[0] ?? '')
    : (controllerPath ?? '');
  const left = String(prefix).replace(/^\/+|\/+$/g, '');
  const right = String(methodPath).replace(/^\/+|\/+$/g, '');
  const parts = [left, right].filter((part) => part.length > 0);
  return `/${parts.join('/')}`;
}

/** Substitute :params so supertest has a concrete URL. */
export function probePath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, 'auth-probe');
}
