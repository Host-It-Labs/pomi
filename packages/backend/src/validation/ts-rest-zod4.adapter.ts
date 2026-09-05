import {
  TsRestHandler as legacyTsRestHandler,
  tsRestHandler as legacyHandler,
} from '@ts-rest/nest';

type DynamicRouteValues = Record<string, never>;
type RouteImplementation = (args: {
  query: DynamicRouteValues;
  params: DynamicRouteValues;
  body: never;
  headers: DynamicRouteValues;
}) => unknown;

export function TsRestHandler(route: unknown): MethodDecorator {
  return legacyTsRestHandler(route as never) as MethodDecorator;
}

export function tsRestHandler(
  route: unknown,
  implementation: RouteImplementation | Record<string, RouteImplementation>
): unknown {
  return legacyHandler(route as never, implementation as never);
}
