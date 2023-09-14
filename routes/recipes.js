const express = require('express');
const router = express.Router();
const { Configuration, OpenAIApi } = require("openai");
const recipePrompt = require("../prompts/recipe.prompt")
const configuration = new Configuration({
  organization: process.env.OPENAI_ORGANIZATION,
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

async function* chunksToLines(chunksAsync) {
  let previous = '';
  for await (const chunk of chunksAsync) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    previous += bufferChunk;
    let eolIndex;
    while ((eolIndex = previous.indexOf('\n')) >= 0) {
      // line includes the EOL
      const line = previous.slice(0, eolIndex + 1).trimEnd();
      if (line === 'data: [DONE]') {
        break;
      }
      if (line.startsWith('data: '))
        yield line
      previous = previous.slice(eolIndex + 1);
    }
  }
}

async function* linesToMessages(
  linesAsync
) {
  for await (const line of linesAsync) {
    const message = line.substring('data :'.length);
    yield message;
  }
}

async function* streamCompletion(data) {
  yield* linesToMessages(chunksToLines(data));
}

//respond with full answer
router.post('/', (req, res) => {
  const { recipe, currency } = req.body;
  const prompt = recipePrompt(recipe, currency)
  console.log(prompt)
  openai.createCompletion({
    model: "text-davinci-003",
    prompt,
    max_tokens: 3000,
    temperature: 0.2
  }).then(({ data }) => {
    const { choices, usage } = data;
    console.log(usage)
    if (choices[0]) {
      res.send(choices[0].text);
    }
    else {
      res.status(400).json({});
    }

  }).catch((error) => {
    console.log(error)
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    }
    else{
      res.send(JSON.stringify(error))
    }
  });
});

//stream back partial progress
router.post('/stream', async (req, res, next) => {
  res.setHeader('Transfer-Encoding', 'chunked');
  const { recipe, currency } = req.body;
  const prompt = recipePrompt(recipe, currency)
  try {
    const completion = await openai.createCompletion({
      model: "text-davinci-003",
      prompt,
      max_tokens: 3000,
      temperature: 0.2,
      stream: true
    }, { responseType: 'stream' })

  for await (const message of streamCompletion(completion.data)) {
      try {
        const parsed = JSON.parse(message)
        res.write(parsed.choices[0].text);
      } catch (error) {
        console.error('Could not JSON parse stream message', message, error);
      }
    }
  }
  catch (error) {
    if (error.response?.status) {
      console.error(error.response.status, error.message);
      error.response.data.on('data', data => {
        const message = data.toString();
        try {
          const parsed = JSON.parse(message);
          console.error('An error occurred during OpenAI request: ', parsed);
        } catch (error) {
          console.error('An error occurred during OpenAI request: ', message);
        }
      });
    } else {
      console.error('An error occurred during OpenAI request', error);
    }
  }
  finally{
    res.end()
  }
});

module.exports = router;
