import type {
  ContractNoBodyType,
  ContractNullType,
  ContractOtherResponse,
  ContractPlainType,
} from '@ts-rest/core';
import type { z } from 'zod/v4';

type RouteShape = {
  method: string;
  path: string;
  responses: Record<number, unknown>;
};

type SchemaInput<T> = T extends ContractNullType
  ? null
  : T extends ContractNoBodyType
    ? undefined
    : T extends ContractPlainType<infer Value>
      ? Value
      : T extends z.ZodType
        ? z.input<T>
        : T;

type SchemaOutput<T> =
  T extends ContractOtherResponse<infer Body>
    ? SchemaOutput<Body>
    : T extends ContractNullType
      ? null
      : T extends ContractNoBodyType
        ? undefined
        : T extends ContractPlainType<infer Value>
          ? Value
          : T extends z.ZodType
            ? z.output<T>
            : T;

type PathParameters<Path extends string> =
  Path extends `${string}:${infer Parameter}/${infer Rest}`
    ? { [Key in Parameter | keyof PathParameters<`/${Rest}`>]: string }
    : Path extends `${string}:${infer Parameter}`
      ? { [Key in Parameter]: string }
      : Record<never, never>;

type Merge<Left, Right> = Omit<Left, keyof Right> & Right;

type QueryRequest<Route> = Route extends { query: infer Query }
  ? Record<never, never> extends SchemaInput<Query>
    ? { query?: SchemaInput<Query> }
    : { query: SchemaInput<Query> }
  : Record<never, never>;

type BodyRequest<Route> = Route extends { body: infer Body }
  ? Body extends ContractNoBodyType
    ? Record<never, never>
    : { body: SchemaInput<Body> }
  : Record<never, never>;

type ParamsRequest<Route extends RouteShape> =
  Merge<
    PathParameters<Route['path']>,
    Route extends { pathParams: infer Params } ? SchemaInput<Params> : object
  > extends infer Params
    ? keyof Params extends never
      ? Record<never, never>
      : { params: Params }
    : never;

type ClientOptions = {
  extraHeaders?: Record<string, string | undefined>;
  fetchOptions?: RequestInit & Record<string, unknown>;
  overrideClientOptions?: Record<string, unknown>;
  cache?: RequestCache;
  next?: unknown;
};

type RouteRequest<Route extends RouteShape> = QueryRequest<Route> &
  BodyRequest<Route> &
  ParamsRequest<Route> &
  ClientOptions;

type RouteResponse<Route extends RouteShape> = {
  [Status in keyof Route['responses'] & number]: {
    status: Status;
    body: SchemaOutput<Route['responses'][Status]>;
    headers: Headers;
  };
}[keyof Route['responses'] & number];

type RouteFunction<Route extends RouteShape> =
  Record<never, never> extends RouteRequest<Route>
    ? (request?: RouteRequest<Route>) => Promise<RouteResponse<Route>>
    : (request: RouteRequest<Route>) => Promise<RouteResponse<Route>>;

export type TsRestZod4Client<Router> = {
  [Key in keyof Router]: Router[Key] extends RouteShape
    ? RouteFunction<Router[Key]>
    : Router[Key] extends object
      ? TsRestZod4Client<Router[Key]>
      : never;
};
