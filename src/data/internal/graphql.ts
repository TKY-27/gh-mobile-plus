import { initGraphQLTada } from "gql.tada";
import type { introspection } from "../graphql-env";

export const graphql = initGraphQLTada<{
  introspection: introspection;
  scalars: {
    Base64String: string;
    BigInt: string;
    Date: string;
    DateTime: string;
    GitObjectID: string;
    GitRefname: string;
    GitSSHRemote: string;
    GitTimestamp: string;
    HTML: string;
    PreciseDateTime: string;
    URI: string;
    X509Certificate: string;
  };
}>();
