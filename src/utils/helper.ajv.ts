import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });

// Register standard formats: uri, date-time, date, time, etc.
addFormats(ajv);

ajv.addFormat("media-uri", {
  type: "string",
  validate: (value: string) => {
    return (
      typeof value === "string" &&
      (
        value.startsWith("/uploads/") ||
        value.startsWith("http://") ||
        value.startsWith("https://")
      )
    );
  }
});

export default ajv;
