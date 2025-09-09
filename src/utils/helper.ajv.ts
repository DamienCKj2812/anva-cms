import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });

// Register standard formats: email, uri, date-time, date, time, etc.
addFormats(ajv);

ajv.addFormat("image-uri", {
  type: "string",
  validate: (uri: string) => /^https?:\/\/.*\.(?:png|jpg|jpeg|gif|webp)$/i.test(uri),
});

export default ajv;
