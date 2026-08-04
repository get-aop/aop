import { createTemplateLoader } from "./template-loader.ts";

const templateLoader = createTemplateLoader();

export const loadTaskMethodology = (): Promise<string> => templateLoader.load("planning.md.hbs");
