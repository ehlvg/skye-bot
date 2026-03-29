import Exa from "exa-js";
import { EXA_API_KEY } from "./config.js";

export interface ExaResult {
  title: string;
  url: string;
  text: string;
  publishedDate?: string;
}

let _exa: Exa | null = null;

function getClient(): Exa {
  if (!EXA_API_KEY) throw new Error("EXA_API_KEY not set");
  if (!_exa) _exa = new Exa(EXA_API_KEY);
  return _exa;
}

export async function exaSearch(query: string, numResults = 5): Promise<ExaResult[]> {
  const exa = getClient();

  const result = await exa.search(query, {
    numResults: Math.min(numResults, 10),
    type: "auto",
    contents: {
      highlights: {
        maxCharacters: 1000,
        numSentences: 5,
      },
    },
  });

  return result.results.map((r: any) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    text: Array.isArray(r.highlights) ? r.highlights.join(" ... ") : (r.text ?? ""),
    publishedDate: r.publishedDate,
  }));
}
