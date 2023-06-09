const express = require('express');
const router = express.Router();
const { Configuration, OpenAIApi } = require("openai");
const recipePrompt = require("../prompts/recipe.prompt")
const configuration = new Configuration({
  organization: process.env.OPENAI_ORGANIZATION,
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);


//respond with full answer
router.post('/', (req, res) => {
  const { recipe, currency } = req.body;
  const prompt = recipePrompt(recipe, currency)
  openai.createCompletion({
    model: "text-davinci-003",
    prompt,
    max_tokens: 2000,
    temperature: 0.2
  }).then(({ data }) => {
    const { choices, usage } = data;
    const { ingredients, errors } = JSON.parse((choices[0] && choices[0].text) || '{"errors":[]}')
    if (ingredients) {
      //console.log(ingredients)
      res.json(ingredients);
    }
    else {
      res.status(400).json(errors);
    }

  }).catch((err) => console.log(err));
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
      max_tokens: 2000,
      temperature: 0.2,
      stream: true
    }, { responseType: 'stream' })
    completion.data.on('data', data => {
      const lines = data.toString().split('\n').filter(line => line.trim() !== '');
      for (const line of lines) {
        const message = line.replace(/^data: /, '');
        try {
          if (message === '[DONE]') {
            res.end()
          }
          else{
            const parsed = JSON.parse(message);
            res.write(parsed.choices[0].text);
          }
        } catch (error) {
          console.error('Could not JSON parse stream message', message, error);
        }
      }
    });
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
});

module.exports = router;
