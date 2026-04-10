import Joi from 'joi';

const text = Joi.string().allow('');
const grpcOneofMarker = text.optional();

const otlpTextValueSchema = Joi.object({
  stringValue: text.required(),
  // gRPC/proto-loader can add this marker as value: 'stringValue'.
  value: grpcOneofMarker
});

const attributeSchema = Joi.object({
  key: Joi.string().required(),
  value: otlpTextValueSchema.optional()
});

const allowedResourceAttributeKeys = [
  'service.name',
  'service.version',
  'deployment.environment.name'
];

const resourceAttributeSchema = attributeSchema.keys({
  key: Joi.string().valid(...allowedResourceAttributeKeys).required()
});

const logRecordSchema = Joi.object({
  timeUnixNano: text.optional(),
  observedTimeUnixNano: text.optional(),
  severityNumber: Joi.number().optional(),
  severityText: text.optional(),
  body: otlpTextValueSchema.required(),
  attributes: Joi.array().items(attributeSchema).optional(),
  droppedAttributesCount: Joi.number().optional(),
  flags: Joi.number().optional(),
  traceId: Joi.alternatives().try(text, Joi.binary()).optional(),
  spanId: Joi.alternatives().try(text, Joi.binary()).optional()
});

const scopeLogSchema = Joi.object({
  scope: Joi.object({
    name: text.optional(),
    version: text.optional(),
    attributes: Joi.array().items(attributeSchema).optional(),
    droppedAttributesCount: Joi.number().optional()
  }).optional(),
  logRecords: Joi.array().items(logRecordSchema).min(1).required(),
  schemaUrl: text.optional()
});

const resourceLogSchema = Joi.object({
  resource: Joi.object({
    attributes: Joi.array()
      .items(resourceAttributeSchema)
      .custom((attributes, helpers) => {
        const hasServiceName = attributes.some((attribute: any) => {
          return (
            attribute?.key === 'service.name' &&
            typeof attribute?.value?.stringValue === 'string' &&
            attribute.value.stringValue.trim() !== ''
          );
        });

        if (!hasServiceName) {
          return helpers.error('any.custom');
        }

        return attributes;
      }, 'service.name validation')
      .required(),
    droppedAttributesCount: Joi.number().optional()
  }).required(),
  scopeLogs: Joi.array().items(scopeLogSchema).min(1).required(),
  schemaUrl: text.optional()
});

export const otlpLogsPayloadSchema = Joi.object({
  resourceLogs: Joi.array().items(resourceLogSchema).min(1).required()
});
