package com.gill.web.storage;

import io.minio.MinioClient;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.PutObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.http.Method;
import java.io.ByteArrayInputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Map;
import org.springframework.stereotype.Component;

/** Low-level signed download adapter; the caller must authorize the exact immutable key. */
@Component
public class TeamBlobStore {
 private String bucket() {
  return System.getenv().getOrDefault("MINIO_BUCKET","gill-files");
 }
 private MinioClient client(String endpoint) {
  return MinioClient.builder().endpoint(endpoint).region("us-east-1")
   .credentials(System.getenv().getOrDefault("MINIO_ROOT_USER","gilladmin"),System.getenv().getOrDefault("MINIO_ROOT_PASSWORD",""))
   .build();
 }
 private MinioClient internal() {
  return client(System.getenv().getOrDefault("MINIO_ENDPOINT","http://localhost:9000"));
 }
 public record TemplateBlob(String key, long size, boolean utf8) {}

 public TemplateBlob saveTemplateFile(long uid, byte[] data) {
  try {
   String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(data));
   String key = "templates/" + uid + "/" + hash;
   boolean utf8 = isText(data);
   try (var stream = new ByteArrayInputStream(data)) {
    internal().putObject(PutObjectArgs.builder().bucket(bucket()).object(key)
     .stream(stream,data.length,-1).contentType("application/octet-stream")
     .userMetadata(Map.of("utf8",Boolean.toString(utf8))).build());
   }
   return new TemplateBlob(key,data.length,utf8);
  } catch(Exception error) {
   throw new IllegalStateException("无法保存模板文件",error);
  }
 }

 public TemplateBlob templateFile(long uid, String key) {
  if (!key.matches("templates/" + uid + "/[a-f0-9]{64}")) {
   throw new IllegalArgumentException("SCOPE_FORBIDDEN: 模板文件不属于当前工作区");
  }
  try {
   var info = internal().statObject(StatObjectArgs.builder().bucket(bucket()).object(key).build());
   return new TemplateBlob(key,info.size(),Boolean.parseBoolean(info.userMetadata().get("utf8")));
  } catch(io.minio.errors.ErrorResponseException error) {
   if (java.util.Set.of("NoSuchKey","NoSuchObject","404").contains(error.errorResponse().code()))
    throw new IllegalArgumentException("NOT_FOUND: 模板文件未上传");
   throw new IllegalStateException("无法核对模板文件",error);
  } catch(Exception error) {
   throw new IllegalStateException("无法核对模板文件",error);
  }
 }

 private boolean isText(byte[] data) {
  for(byte value:data)if(value==0)return false;
  try {
   StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(data));
   return true;
  } catch(java.nio.charset.CharacterCodingException error) {
   return false;
  }
 }

 public String download(String key) {
  try {
   return client(System.getenv().getOrDefault("MINIO_PUBLIC_ENDPOINT","http://localhost:9000"))
    .getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
    .bucket(bucket()).object(key).method(Method.GET).expiry(120).build());
  } catch(Exception error){throw new IllegalStateException("无法生成版本归档下载链接",error);}
 }
}
