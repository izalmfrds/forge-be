import app from "./app.js";

const port = Number(process.env.PORT || 4000);

if (!process.env.VERCEL) {
  app.listen(port, () => {
    console.log(`Forge API listening on http://localhost:${port}`);
  });
}

export default app;
