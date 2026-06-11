import express from "express";
import cors from "cors";
import routes from "./routes";

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(routes);

app.listen(PORT, () => {
  console.log(`Alcovia backend running on http://localhost:${PORT}`);
});
