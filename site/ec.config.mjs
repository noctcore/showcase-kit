import { defineEcConfig } from '@astrojs/starlight/expressive-code';

import { noctcoreCodeConfig } from './src/styles/noctcore/expressive-code.mjs';

// Code frames follow the Observatory preset: its dark and light code themes,
// the frame chrome on Starlight's colours, and the code area on --nc-code-bg.
export default defineEcConfig({
  ...noctcoreCodeConfig('observatory'),
});
