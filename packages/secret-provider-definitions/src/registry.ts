import { makeSecretProviderDefinitionRegistry } from "@prismux/secret-provider-core/shared/definition";
import * as OnePassword from "@prismux/secret-provider-onepassword/shared/definition";

export const builtInSecretProviderDefinitions = makeSecretProviderDefinitionRegistry([
  OnePassword.definition,
]);
