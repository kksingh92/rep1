/* Copyright 2015 Amazon.com, Inc. or its affiliates. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License"). You may not use
this file except in compliance with the License. A copy of the License is
located at

http://aws.amazon.com/apache2.0/

or in the "license" file accompanying this file. This file is distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the License for the specific language governing permissions and
limitations under the License. */

// AWS Lambda function acting as Event Processor for AWS Lambda Stream Processing Reference Architecture

console.log('Loading function');

var AWS = require('aws-sdk');

var doc = new AWS.DynamoDB.DocumentClient();
var config;

exports.handler = function(event, context) {
  if (config) {
    handleEvent(event, context);
  } else {
    var params = {
      TableName: 'StreamProcessingRefArchConfig',
      Key: { Environment: 'demo' }
    };
    doc.get(params, function(err, data) {
      if (err) {
        console.log(err, err.stack);
        context.fail(err);
      } else {
        config = data.Item;
        handleEvent(event, context);
      }
    });
  }
};

function handleEvent(event, context) {
  console.log('Received event:', JSON.stringify(event, null, 2));

  var tableName = config['EventDataTable'];

  var putItems = [];

  /*
  * This assumes the batch size configured in the the event source mapping
  * is set to a maximum of 25 records. Depending on the characteristics of
  * your system it may make sense to consume larger batches from the stream
  * and manage the batch sizes sent to DynamoDB within the funtion.
  */
  event.Records.forEach(function(record) {
    payload = new Buffer(record.kinesis.data, 'base64').toString('ascii');
    console.log('Decoded payload:', payload);

    var tweet = JSON.parse(payload);

    console.log('User:', tweet.user.name);
    console.log('Timestamp:', tweet.created_at);

    putItems.push({
      PutRequest: {
          Item: {
              Username: tweet.user.name,
              Timestamp: new Date(tweet.created_at.replace(/( \+)/, ' UTC$1')).toISOString(),
              Message: tweet.text
          }
      }
    });
  });

  var tableItems = {};
  tableItems[tableName] = putItems;
  writeItems(tableItems, 0, context);
}

function writeItems(items, retries, context) {
  doc.batchWrite({ RequestItems: items },
    function(err, data) {
      if (err) {
        console.log('DDB call failed: ' + err, err.stack);
        context.fail(err);
      } else {
        if(Object.keys(data.UnprocessedItems).length) {
          console.log('Unprocessed items remain, retrying.');
          var delay = Math.min(Math.pow(2, retries) * 100, context.getRemainingTimeInMillis() - 200);
          setTimeout(function() {writeItems(data.UnprocessedItems, retries + 1)}, delay);
        } else {
          context.succeed();
        }
      }
    }
  );
}
